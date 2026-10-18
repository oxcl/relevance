import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from jinja2 import Template

PATCH_BROWSER_TEMPLATE = Template("""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Morphe Patch Browser — Relevance</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:2rem}
h1{font-size:1.5rem;margin-bottom:.5rem}
.summary{color:#8b949e;margin-bottom:1.5rem;font-size:.9rem}
.controls{display:flex;gap:1rem;margin-bottom:1rem;flex-wrap:wrap}
input[type=text],select{
  padding:.5rem .75rem;
  background:#161b22;
  border:1px solid #30363d;
  border-radius:6px;
  color:#c9d1d9;
  font-size:.9rem
}
input[type=text]{width:320px}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{background:#161b22;padding:.75rem;text-align:left;border-bottom:2px solid #30363d}
td{padding:.75rem;border-bottom:1px solid #21262d}
tr:hover{background:#161b22}
.badge{
  display:inline-block;padding:.15rem .5rem;border-radius:12px;
  font-size:.75rem;font-weight:600
}
.badge-yes{background:#238636;color:#fff}
.badge-no{background:#30363d;color:#8b949e}
.pkg{font-family:monospace;font-size:.8rem;color:#8b949e}
.timestamp{color:#484f58;font-size:.75rem;margin-top:2rem}
a{color:#58a6ff;text-decoration:none}
</style>
</head>
<body>
<h1>Morphe Patch Browser (v{{ patches_version }})</h1>
<p class="summary">{{ total_patches }} patches across {{ total_apps }} apps</p>
<div class="controls">
<input type="text" id="search" placeholder="Search Morphe patches..." autofocus>
<select id="filter-app"><option value="">All apps</option></select>
</div>
<table>
<thead>
<tr>
<th>Patch Name</th>
<th>Target App</th>
<th>Compatible Versions</th>
<th>Default</th>
<th>Description</th>
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
const apps=[...new Set(DATA.flatMap(p=>(p.packages||[]).map(pkg=>pkg.name)))].sort();
apps.forEach(a=>{
  const o=document.createElement("option");
  o.value=a;o.textContent=a;filterApp.appendChild(o);
});
function render(){
  const q=search.value.toLowerCase();
  const fa=filterApp.value;
  const rows=DATA.filter(p=>{
    const desc=(p.description||"").toLowerCase();
    if(q&&!p.name.toLowerCase().includes(q)&&!desc.includes(q))return false;
    if(fa&&!(p.packages||[]).some(pkg=>pkg.name===fa))return false;
    return true;
  });
  tbody.innerHTML=rows.map(p=>{
    const pkgs=(p.packages||[]).map(pkg=>`<span class="pkg">${pkg.name}</span>`).join(", ");
    const vers=(p.packages||[]).flatMap(pkg=>pkg.versions||[]).join(", ");
    const yes=`<span class="badge badge-yes">Yes</span>`;
    const no=`<span class="badge badge-no">No</span>`;
    const def=p.default?yes:no;
    const d=p.description||"";
    return `<tr><td>${p.name}</td><td>${pkgs}</td><td>${vers}</td>`+
      `<td>${def}</td><td>${d}</td></tr>`;
  }).join("");
}
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
<title>{{ repo_name }} — F-Droid Repository</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;
  display:flex;justify-content:center;align-items:center;min-height:100vh;padding:2rem
}
.container{
  max-width:760px;width:100%;background:#161b22;border:1px solid #30363d;
  border-radius:12px;padding:2rem
}
h1{font-size:2rem;margin-bottom:.5rem}
.desc{color:#8b949e;margin-bottom:1.5rem;font-size:1rem}
.repo-box{
  background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:1rem;
  margin-bottom:1.5rem;font-family:monospace;font-size:.85rem;word-break:break-all
}
.apps{
  display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
  gap:1rem;margin-bottom:1.5rem
}
.app-card{
  background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:1rem;
  display:flex;align-items:center;gap:.85rem
}
.app-card img{width:48px;height:48px;border-radius:10px}
.app-card .title{font-weight:600;color:#f0f6fc}
.app-card .sub{font-size:.75rem;color:#8b949e;font-family:monospace}
.links{display:flex;gap:1rem;flex-wrap:wrap}
a.btn{
  display:inline-block;padding:.65rem 1.25rem;background:#238636;
  border-radius:8px;color:#fff;text-decoration:none;font-weight:600;font-size:.9rem
}
a.btn-secondary{background:#21262d;border:1px solid #30363d;color:#58a6ff}
.footer{margin-top:1.5rem;color:#484f58;font-size:.8rem}
</style>
</head>
<body>
<div class="container">
<h1>{{ repo_name }}</h1>
<p class="desc">{{ repo_description }}</p>
<div class="repo-box">
<strong>F-Droid Repo URL:</strong><br>
<a href="{{ fdroid_add_url }}" style="color:#58a6ff">{{ fdroid_add_url }}</a>
</div>
<div class="apps">
{% for v in variants %}
<div class="app-card">
  <img src="icons/{{ v.package_name }}.png" alt="{{ v.name }}">
  <div>
    <div class="title">{{ v.name }}</div>
    <div class="sub">{{ v.package_name }}</div>
    <div class="sub">v{{ v.version }}</div>
  </div>
</div>
{% endfor %}
</div>
<div class="links">
<a class="btn" href="{{ fdroid_add_url }}">Add to F-Droid</a>
<a class="btn btn-secondary" href="patch-browser.html">Morphe Patch Browser</a>
<a class="btn btn-secondary" href="{{ github_url }}">GitHub Repository</a>
</div>
<p class="footer">Powered by OpenCode (DeepSeek V4.1 Flash) + Morphe Patches</p>
</div>
</body>
</html>""")


def generate_patch_browser_from_morphe_json(
    patches_list_path: Path,
    output_dir: Path,
) -> None:
    raw = json.loads(patches_list_path.read_text(encoding="utf-8"))
    patches_version = raw.get("version", "latest")
    formatted_patches: list[dict[str, Any]] = []
    apps_set: set[str] = set()

    for p in raw.get("patches", []):
        pkgs = []
        for cp in p.get("compatiblePackages") or []:
            pkg_name = cp.get("packageName") or "universal"
            apps_set.add(pkg_name)
            vers = [t.get("version") for t in (cp.get("targets") or []) if t.get("version")]
            pkgs.append({"name": pkg_name, "versions": vers})
        formatted_patches.append(
            {
                "name": p.get("name", ""),
                "description": p.get("description", ""),
                "default": bool(p.get("default", True)),
                "packages": pkgs,
            }
        )

    timestamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    html = PATCH_BROWSER_TEMPLATE.render(
        patches_version=patches_version,
        total_patches=len(formatted_patches),
        total_apps=len(apps_set),
        patches_json=json.dumps(formatted_patches),
        timestamp=timestamp,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "patch-browser.html").write_text(html, encoding="utf-8")


def generate_landing_page(
    repo_name: str,
    repo_description: str,
    repo_url: str,
    fingerprint: str,
    github_url: str,
    variants_info: list[dict[str, str]],
    output_dir: Path,
) -> None:
    clean_url = repo_url.rstrip("/")
    fdroid_add_url = (
        f"{clean_url}?fingerprint={fingerprint}"
        if fingerprint and fingerprint != "unknown"
        else clean_url
    )
    html = LANDING_PAGE_TEMPLATE.render(
        repo_name=repo_name,
        repo_description=repo_description,
        fdroid_add_url=fdroid_add_url,
        github_url=github_url,
        variants=variants_info,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "index.html").write_text(html, encoding="utf-8")
