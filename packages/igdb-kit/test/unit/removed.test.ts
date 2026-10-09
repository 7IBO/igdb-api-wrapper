import { describe, expect, test } from "bun:test";
import { relationalFake, testClient } from "./helpers";

const tables = {
  games: [{ id: 1 }, { id: 2 }, { id: 30 }],
  companies: [{ id: 5 }],
  entity_types: [
    { id: 1, name: "Game" },
    { id: 2, name: "Company" },
    { id: 3, name: "Game Localization" },
  ],
  report_types: [
    { id: 1, name: "Duplicate" },
    { id: 2, name: "Invalid" },
  ],
  reports: [
    { id: 1, source_item_id: 10, target_item_id: 2, report_type: 1, entity_type: 1 },
    { id: 2, source_item_id: 11, report_type: 2, entity_type: 1 },
    // A duplicate of a game that was itself a duplicate: the chain ends on game 30.
    { id: 3, source_item_id: 12, target_item_id: 20, report_type: 1, entity_type: 1 },
    { id: 4, source_item_id: 20, target_item_id: 30, report_type: 1, entity_type: 1 },
    // A company report on the same id as a game: not the game's.
    { id: 5, source_item_id: 13, target_item_id: 5, report_type: 1, entity_type: 2 },
    // A replacement that no longer exists either, with no report.
    { id: 6, source_item_id: 14, target_item_id: 99, report_type: 1, entity_type: 1 },
  ],
};

describe("removed()", () => {
  test("lists the ids IGDB no longer has, with the reason and the replacement", async () => {
    const mock = relationalFake(tables);
    const igdb = testClient(mock.fetch);
    expect(await igdb.games.removed([1, 2, 10, 11, 12, 13, 14, 10])).toEqual([
      { id: 10, reason: "Duplicate", replacement: 2 },
      { id: 11, reason: "Invalid", replacement: null },
      { id: 12, reason: "Duplicate", replacement: 30 },
      { id: 13, reason: null, replacement: null },
      { id: 14, reason: "Duplicate", replacement: null },
    ]);
    expect(await igdb.companies.removed([5, 13])).toEqual([{ id: 13, reason: "Duplicate", replacement: 5 }]);
  });

  test("sends nothing more when every id exists", async () => {
    const mock = relationalFake(tables);
    const igdb = testClient(mock.fetch);
    expect(await igdb.games.removed([1, 2])).toEqual([]);
    expect(await igdb.games.removed([])).toEqual([]);
    expect(mock.calls.map((call) => call.body)).toEqual(["fields id; where id = (1,2); limit 2;"]);
  });
});
