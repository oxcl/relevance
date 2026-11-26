// Signing keys are generated in the browser and stored only as encrypted GitHub Actions secrets.
import forge from 'node-forge';

export interface Keystore {
  p12: Uint8Array;
  password: string;
  alias: string;
  fingerprint: string; // SHA-256 of the certificate, hex upper
  certPem: string;
}

function randomPassword(n = 28) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => chars[x % chars.length]).join('');
}

export async function fingerprintOf(cert: forge.pki.Certificate): Promise<string> {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const bytes = Uint8Array.from(der, (c) => c.charCodeAt(0));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...h].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function generateKeystore(owner: string, alias = 'relevance'): Promise<Keystore> {
  const kp = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  let bin = '';
  for (const b of pkcs8) bin += String.fromCharCode(b);
  const privateKey = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(bin)) as forge.pki.rsa.PrivateKey;
  const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(9));
  cert.validity.notBefore = new Date(Date.now() - 86400_000);
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 35);
  const attrs = [
    { name: 'commonName', value: `${owner} via Relevance` },
    { name: 'organizationName', value: 'Relevance' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(privateKey, forge.md.sha256.create());
  const password = randomPassword();
  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, [cert], password, {
    algorithm: '3des',
    friendlyName: alias,
    generateLocalKeyId: true,
  });
  const der = forge.asn1.toDer(p12Asn1).getBytes();
  return {
    p12: Uint8Array.from(der, (c) => c.charCodeAt(0)),
    password,
    alias,
    fingerprint: await fingerprintOf(cert),
    certPem: forge.pki.certificateToPem(cert),
  };
}

/** Validate a user-supplied PKCS#12 keystore and read its alias + fingerprint. */
export async function inspectKeystore(bytes: Uint8Array, password: string): Promise<{ alias: string; fingerprint: string; certPem: string }> {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(bin), password);
  } catch {
    throw new Error('Could not open the keystore. Is it a PKCS#12 (.p12/.pfx) file and is the password right?');
  }
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = bags[forge.pki.oids.certBag]?.[0];
  if (!certBag?.cert) throw new Error('No certificate found in the keystore');
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const kb = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
  if (!kb) throw new Error('No private key found in the keystore');
  return {
    alias: kb.attributes?.friendlyName?.[0] || certBag.attributes?.friendlyName?.[0] || '1',
    fingerprint: await fingerprintOf(certBag.cert),
    certPem: forge.pki.certificateToPem(certBag.cert),
  };
}

export function formatFingerprint(fp: string | undefined) {
  if (!fp) return '';
  return fp.replace(/(.{4})/g, '$1 ').trim();
}
