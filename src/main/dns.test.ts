import { describe, expect, it, vi } from "vitest";
import { ReverseDns } from "./dns";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("ReverseDns", () => {
  it("answers from the cache after the first lookup", async () => {
    const resolve = vi.fn(async () => ["dns.google"]);
    const dns = new ReverseDns(resolve);
    expect(dns.lookup("8.8.8.8")).toBeNull();
    await tick();
    expect(dns.lookup("8.8.8.8")).toBe("dns.google");
    expect(dns.lookup("8.8.8.8")).toBe("dns.google");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("does not start a second lookup while one is in flight", async () => {
    const resolve = vi.fn(() => new Promise<string[]>(() => {}));
    const dns = new ReverseDns(resolve, { timeoutMs: 60_000 });
    expect(dns.lookup("8.8.8.8")).toBeNull();
    expect(dns.lookup("8.8.8.8")).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("caches failures", async () => {
    const resolve = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    const dns = new ReverseDns(resolve);
    expect(dns.lookup("10.0.0.1")).toBeNull();
    await tick();
    expect(dns.lookup("10.0.0.1")).toBeNull();
    expect(dns.lookup("10.0.0.1")).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("caches null when the resolver does not settle in time", async () => {
    const resolve = vi.fn(() => new Promise<string[]>(() => {}));
    const dns = new ReverseDns(resolve, { timeoutMs: 5 });
    expect(dns.lookup("8.8.4.4")).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(dns.lookup("8.8.4.4")).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest entry above max", async () => {
    const resolve = vi.fn(async (ip: string) => [`${ip}.example`]);
    const dns = new ReverseDns(resolve, { max: 2 });
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      dns.lookup(ip);
      await tick();
    }
    expect(dns.lookup("2.2.2.2")).toBe("2.2.2.2.example");
    expect(dns.lookup("3.3.3.3")).toBe("3.3.3.3.example");
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(dns.lookup("1.1.1.1")).toBeNull();
    await tick();
    expect(resolve).toHaveBeenCalledTimes(4);
  });
});
