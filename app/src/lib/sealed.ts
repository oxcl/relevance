// libsodium crypto_box_seal (used by GitHub to encrypt Actions secrets), built from tweetnacl + blake2b.
import nacl from 'tweetnacl';
import { blake2b } from 'blakejs';

export function sealedBox(message: Uint8Array, recipientPk: Uint8Array): Uint8Array {
  const eph = nacl.box.keyPair();
  const nonceInput = new Uint8Array(64);
  nonceInput.set(eph.publicKey, 0);
  nonceInput.set(recipientPk, 32);
  const nonce = blake2b(nonceInput, undefined, 24);
  const boxed = nacl.box(message, nonce, recipientPk, eph.secretKey);
  const out = new Uint8Array(32 + boxed.length);
  out.set(eph.publicKey, 0);
  out.set(boxed, 32);
  return out;
}

export const toB64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
export const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
