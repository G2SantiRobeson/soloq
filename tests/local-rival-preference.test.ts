import { expect, it } from "vitest";
import {
  readLocalRival,
  writeLocalRival,
  rivalPreferenceKey,
  type RivalStorage,
} from "@/lib/local-rival-preference";
import { demoPlayers } from "@/server/demo";
function storage(): RivalStorage {
  const values = new Map<string, string>();
  return {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => {
      values.set(k, v);
    },
    removeItem: (k) => {
      values.delete(k);
    },
  };
}
const [player, rival] = demoPlayers("soloq").slice(3, 5);
const candidates = [rival],
  key = rivalPreferenceKey(player, "soloq")!;
it("saves only a validated public ID and survives a new read", () => {
  const s = storage();
  expect(writeLocalRival(s, key, player, candidates, rival.id)).toBe(true);
  expect(JSON.parse(s.getItem(key)!)).toEqual({ version: 1, rivalId: "demo-5" });
  expect(readLocalRival(s, key, player, candidates)).toEqual({ id: "demo-5", status: "valid" });
  writeLocalRival(s, key, player, candidates, null);
  expect(readLocalRival(s, key, player, candidates).status).toBe("empty");
});
it("separates profile, platform and ranked modality", () => {
  expect(rivalPreferenceKey(player, "flex")).not.toBe(key);
  expect(rivalPreferenceKey(rival, "soloq")).not.toBe(key);
  expect(rivalPreferenceKey({ ...player, platform: "EUW1" }, "soloq")).not.toBe(key);
  expect(rivalPreferenceKey(player, "5v5")).toBeNull();
});
it("isolates independent browsers without a shared store", () => {
  const a = storage(),
    b = storage();
  writeLocalRival(a, key, player, candidates, rival.id);
  expect(readLocalRival(b, key, player, candidates).id).toBeNull();
});
it.each([
  "not JSON",
  "null",
  "{}",
  '{"version":1,"rivalId":"demo-4"}',
  '{"version":1,"rivalId":"demo-999"}',
  '{"version":2,"rivalId":"demo-5"}',
  '{"version":1,"rivalId":"demo-5","extra":"secret"}',
])("rejects invalid or obsolete payload %s", (raw) => {
  const s = storage();
  s.setItem(key, raw);
  expect(readLocalRival(s, key, player, candidates).id).toBeNull();
  expect(s.getItem(key)).toBe(raw);
});
it("rejects invalid writes and handles storage failures", () => {
  const s = storage();
  expect(() => writeLocalRival(s, key, player, candidates, "demo-4")).toThrow("INVALID_RIVAL");
  const blocked = {
    getItem: () => {
      throw Error("BLOCKED");
    },
    setItem: () => {
      throw Error("BLOCKED");
    },
    removeItem: () => {
      throw Error("BLOCKED");
    },
  };
  expect(readLocalRival(blocked, key, player, candidates)).toEqual({
    id: null,
    status: "unavailable",
  });
  expect(writeLocalRival(blocked, key, player, candidates, rival.id)).toBe(false);
});
