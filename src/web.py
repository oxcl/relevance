import json  # noqa: E501
from datetime import UTC, datetime
from pathlib import Path

from jinja2 import Template

from src.operations.patch.revanced import list_patches

PATCH_BROWSER_TEMPLATE = Template("""<!DOCTYPE html>  # noqa: E501
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Patch Browser — Relevance</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:2rem}
h1{font-size:1.5rem;margin-bottom:.5rem}
.summary{color:#8b949e;margin-bottom:1.5rem;font-size:.9rem}
.controls{display:flex;gap:1rem;margin-bottom:1rem;flex-wrap:wrap}
input[type=text]{
  padding:.5rem .75rem;
  background:#161b22;
  border:1px solid #30363d;
  border-radius:6px;
  color:#c9d1d9;
  font-size:.9rem;
  width:300px
}
input[type=text]:focus{outline:none;border-color:#58a6ff}
select{
  padding:.5rem .75rem;
  background:#161b22;
  border:1px solid #30363d;
  border-radius:6px;
  color:#c9d1d9;
  font-size:.9rem
}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{
  background:#161b22;
  padding:.75rem;
  text-align:left;
  border-bottom:2px solid #30363d;
  cursor:pointer;
  user-select:none;
  position:sticky;
  top:0
}
th:hover{background:#1f2937}
td{padding:.75rem;border-bottom:1px solid #21262d}
tr:hover{background:#161b22}
.badge{
  display:inline-block;
  padding:.15rem .5rem;
  border-radius:12px;
  font-size:.75rem;
  font-weight:600
}
.badge-yes{background:#238636;color:#fff}
.badge-no{background:#30363d;color:#8b949e}
.pkg{font-family:monospace;font-size:.8rem;color:#8b949e}
.sort-arrow{margin-left:.25rem;font-size:.7rem}
.timestamp{color:#484f58;font-size:.75rem;margin-top:2rem}
a{color:#58a6ff;text-decoration:none}
a:hover{text-decoration:underline}
</style>
</head>
<body>
<h1>Patch Browser</h1>
<p class="summary">{{ total_patches }} patches across {{ total_apps }} apps</p>
<div class="controls">
<input type="text" id="search" placeholder="Search patches..." autofocus>
<select id="filter-app"><option value="">All apps</option></select>
</div>
<table>
<thead>
<tr>
<th data-col="name">Patch Name <span class="sort-arrow"></span></th>
<th data-col="bundle">Bundle <span class="sort-arrow"></span></th>
<th data-col="app">Target App <span class="sort-arrow"></span></th>
<th data-col="versions">Versions</th>
<th data-col="default">Default <span class="sort-arrow"></span></th>
<th data-col="description">Description</th>
</tr>
</thead>
<tbody id="tbody"></tbody>
</table>
<p class="timestamp">Last updated: {{ timestamp }}</p>
<script>
const DATA={{ patches_json }};
const tbody=document.getElementById("tbody");
const search=document.getElementById("search");
const filterApp=document.getElementById("filter-app");
let sortCol="name",sortAsc=true;
const apps=[...new Set(DATA.flatMap(p=>(p.packages||[]).map(pkg=>pkg.name)))].sort();
apps.forEach(a=>{
  const o=document.createElement("option");
  o.value=a;o.textContent=a;filterApp.appendChild(o)
});
function render(){
  const q=search.value.toLowerCase();
  const fa=filterApp.value;
  let rows=DATA.filter(p=>{
    if(q&&!p.name.toLowerCase().includes(q)
      &&!(p.description||"").toLowerCase().includes(q)
      &&!(p.bundle||"").toLowerCase().includes(q))return false;
    if(fa&&!(p.packages||[]).some(pkg=>pkg.name===fa))return false;
    return true;
  });
  rows.sort((a,b)=>{
    let va=a[sortCol]||"",vb=b[sortCol]||"";
    if(typeof va==="boolean")
      return sortAsc?(va===vb?0:va?-1:1):(va===vb?0:va?1:-1);
    return sortAsc?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va));
  });
  tbody.innerHTML=rows.map(p=>{
    const pkgs=(p.packages||[]).map(pkg=>
      `<span class="pkg">${pkg.name}</span>`
    ).join(", ");
    const vers=(p.packages||[]).flatMap(pkg=>pkg.versions||[]).join(", ");
    const def=p.default
      ?`<span class="badge badge-yes">Yes</span>`
      :`<span class="badge badge-no">No</span>`;
    const desc=p.description||"";
    const row=`<tr>
      <td>${p.name}</td>
      <td>${p.bundle||""}</td>
      <td>${pkgs}</td>
      <td>${vers}</td>
      <td>${def}</td>
      <td>${desc}</td>
    </tr>`;
    return row;
  }).join("");
}
document.querySelectorAll("th[data-col]").forEach(th=>{
  th.addEventListener("click",()=>{
    const col=th.dataset.col;
    if(sortCol===col)sortAsc=!sortAsc;else{sortCol=col;sortAsc=true}
    render();
  });
});
search.addEventListener("input",render);
filterApp.addEventListener("change",render);
render();
</script>
</body>
</html>""")

LANDING_PAGE_TEMPLATE = Template("""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{ repo_name }}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;display:flex;justify-content:center;align-items:center;min-height:100vh}
.container{text-align:center;max-width:600px;padding:2rem}
h1{font-size:2rem;margin-bottom:.5rem}
.desc{color:#8b949e;margin-bottom:2rem;font-size:1.1rem}
.links{display:flex;flex-direction:column;gap:1rem;align-items:center}
a{
  display:block;
  padding:.75rem 1.5rem;
  background:#21262d;
  border:1px solid #30363d;
  border-radius:8px;
  color:#58a6ff;
  text-decoration:none;
  font-size:1rem;
  transition:all .2s;
  width:300px
}
a:hover{background:#30363d;border-color:#58a6ff}
.footer{margin-top:3rem;color:#484f58;font-size:.8rem}
</style>
</head>
<body>
<div class="container">
<h1>{{ repo_name }}</h1>
<p class="desc">{{ repo_description }}</p>
<div class="links">
<a href="{{ repo_url }}">F-Droid Repository</a>
<a href="patch-browser.html">Patch Browser</a>
<a href="{{ github_url }}">GitHub</a>
</div>
<p class="footer">Built with Relevance</p>
</div>
</body>
</html>""")


def generate_patch_browser(patches_paths: list[Path], output_dir: Path) -> None:
    patches = list_patches(patches_paths)

    apps_set = set()
    for p in patches:
        for pkg in p.get("packages", []):
            apps_set.add(pkg["name"])

    timestamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")

    html = PATCH_BROWSER_TEMPLATE.render(
        total_patches=len(patches),
        total_apps=len(apps_set),
        patches_json=json.dumps(patches),
        timestamp=timestamp,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "patch-browser.html").write_text(html)


def generate_landing_page(
    repo_name: str,
    repo_description: str,
    repo_url: str,
    github_url: str,
    output_dir: Path,
) -> None:
    html = LANDING_PAGE_TEMPLATE.render(
        repo_name=repo_name,
        repo_description=repo_description,
        repo_url=repo_url,
        github_url=github_url,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "index.html").write_text(html)
