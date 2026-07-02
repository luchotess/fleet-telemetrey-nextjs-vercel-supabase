import { describe, expect, it } from "vitest";
import { haversineMeters } from "@/lib/domain/anomaly";

describe("haversineMeters", () => {
  it("returns zero for identical coordinates", () => {
    expect(haversineMeters(37.41, -122.08, 37.41, -122.08)).toBe(0);
  });

  it("returns a reasonable distance for a small GPS delta", () => {
    const distance = haversineMeters(37.41, -122.08, 37.42, -122.08);
    expect(distance).toBeGreaterThan(1_100);
    expect(distance).toBeLessThan(1_120);
  });
});
