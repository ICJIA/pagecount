import { describe, it, expect } from 'vitest';
import { isPrivateAddress, assertPublicUrl } from '../src/ssrf';

describe('isPrivateAddress', () => {
  it('flags loopback / private / link-local addresses', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('10.0.0.1')).toBe(true);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('169.254.1.1')).toBe(true);
    expect(isPrivateAddress('::1')).toBe(true);
  });

  it('allows public addresses', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('1.1.1.1')).toBe(false);
  });

  it('flags IPv4-mapped IPv6 loopback in dotted-quad form', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('flags IPv4-mapped IPv6 loopback in HEX form (SSRF bypass regression)', () => {
    // new URL('http://[::ffff:127.0.0.1]/').hostname normalizes to this hex form.
    expect(isPrivateAddress('::ffff:7f00:1')).toBe(true);
  });

  it('flags IPv4-mapped IPv6 link-local', () => {
    expect(isPrivateAddress('::ffff:169.254.1.1')).toBe(true);
  });

  it('flags IPv6 link-local and unique-local', () => {
    expect(isPrivateAddress('fe80::1')).toBe(true);
    expect(isPrivateAddress('fc00::1')).toBe(true);
    expect(isPrivateAddress('fd12::1')).toBe(true);
  });

  it('flags IPv6 loopback and unspecified', () => {
    expect(isPrivateAddress('::1')).toBe(true);
    expect(isPrivateAddress('::')).toBe(true);
  });

  it('allows a public IPv6 address', () => {
    expect(isPrivateAddress('2001:4860:4860::8888')).toBe(false);
  });

  it('flags NAT64-embedded private IPv4 (64:ff9b::/96)', () => {
    expect(isPrivateAddress('64:ff9b::7f00:1')).toBe(true);
  });

  it('flags 6to4-embedded private IPv4 (2002::/16)', () => {
    expect(isPrivateAddress('2002:7f00:1::')).toBe(true);
  });

  it('allows 6to4-embedded public IPv4', () => {
    expect(isPrivateAddress('2002:0808:0808::')).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  it('rejects a literal loopback IP (no DNS)', async () => {
    await expect(assertPublicUrl('http://127.0.0.1/x')).rejects.toMatchObject({ status: 'network-error' });
  });

  it('resolves for a literal public IP', async () => {
    await expect(assertPublicUrl('http://8.8.8.8/x')).resolves.toBeUndefined();
  });

  it('rejects IPv4-mapped IPv6 loopback literal (end-to-end SSRF bypass)', async () => {
    await expect(assertPublicUrl('http://[::ffff:127.0.0.1]/x')).rejects.toMatchObject({ status: 'network-error' });
  });

  it('rejects name-based loopback via DNS resolution', async () => {
    // localhost resolves to 127.0.0.1 / ::1 locally (no external network);
    // exercises the DNS-resolution branch and proves name-based loopback is caught.
    await expect(assertPublicUrl('http://localhost/x')).rejects.toMatchObject({ status: 'network-error' });
  });

  it('rejects a non-http(s) scheme', async () => {
    await expect(assertPublicUrl('ftp://example.com/x')).rejects.toMatchObject({ status: 'network-error' });
  });
});
