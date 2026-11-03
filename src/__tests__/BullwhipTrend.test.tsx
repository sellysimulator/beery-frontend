/**
 * `22-frontend-profile.md` section 2.5 and `CHARTS-PLAN.md` BE-6: the profile's
 * bullwhip trend.
 *
 * Covers acceptance criteria 1 (dots follow date order), 2 (null ratios are
 * excluded and counted) and 3 (fewer than two games shows a sentence), and the
 * three failure modes the package adds: dots in list order, a null drawn as 0
 * or 1, and one game's ratio landing in another role's dataset.
 *
 * `chart.js` and `react-chartjs-2` are not mocked. The builder's output is
 * asserted directly, and the chart's table of plotted values is read through
 * the DOM.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import type { MatchSummary } from "../api/users";
import { BullwhipTrend } from "../components/profile/BullwhipTrend";
import { buildBullwhipTrendConfig } from "../components/profile/bullwhipTrendConfig";
import { roleStyle } from "../components/charts/chartTheme";
import type { Role } from "../types/game";

function match(
  id: number,
  finished_at: string,
  role: Role,
  bullwhip_ratio: number | null,
): MatchSummary {
  return {
    game_id: id,
    room_code: `ROOM${id}XQ`,
    finished_at,
    role,
    weeks_played: 20,
    total_cost: 100,
    bullwhip_ratio,
    chain_total_cost: 400,
    preset_name: null,
  };
}

/** Newest first, the way `GET /users/me/games` delivers it. */
const NEWEST_FIRST: MatchSummary[] = [
  match(4, "2026-10-04T10:00:00Z", "FACTORY", 4.5),
  match(3, "2026-10-03T10:00:00Z", "RETAILER", 2.25),
  match(2, "2026-10-02T10:00:00Z", "FACTORY", 1.5),
  match(1, "2026-10-01T10:00:00Z", "WHOLESALER", 3.125),
];

describe("buildBullwhipTrendConfig", () => {
  it("is a line chart on a logarithmic y axis", () => {
    const config = buildBullwhipTrendConfig(NEWEST_FIRST);
    expect(config.type).toBe("line");
    const scales = config.options?.scales as Record<string, { type?: string }>;
    expect(scales.y.type).toBe("logarithmic");
  });

  it("labels the dots in finished_at order, oldest first, whatever order the list arrived in (criterion 1)", () => {
    const config = buildBullwhipTrendConfig(NEWEST_FIRST);
    expect(config.data.labels).toEqual([
      "2026-10-01T10:00:00Z",
      "2026-10-02T10:00:00Z",
      "2026-10-03T10:00:00Z",
      "2026-10-04T10:00:00Z",
    ]);
    // The same list reversed gives the same chart.
    const reversed = buildBullwhipTrendConfig([...NEWEST_FIRST].reverse());
    expect(reversed.data).toEqual(config.data);
  });

  it("does not plot in list order: ratios follow the dates, not the list (failure mode 1)", () => {
    const config = buildBullwhipTrendConfig(NEWEST_FIRST);
    const factory = config.data.datasets.find((d) => d.label === "Factory");
    // Oldest first: week-1 wholesaler, then factory 1.5, retailer, factory 4.5.
    expect(factory?.data).toEqual([null, 1.5, null, 4.5]);
  });

  it("puts each ratio in its own role dataset and nowhere else (failure mode 3)", () => {
    const config = buildBullwhipTrendConfig(NEWEST_FIRST);
    const byRole = Object.fromEntries(
      config.data.datasets.map((d) => [d.label, d.data]),
    );
    expect(byRole["Wholesaler"]).toEqual([3.125, null, null, null]);
    expect(byRole["Retailer"]).toEqual([null, null, 2.25, null]);
    expect(byRole["Factory"]).toEqual([null, 1.5, null, 4.5]);
    // Every game is in exactly one dataset.
    for (let i = 0; i < 4; i += 1) {
      const filled = config.data.datasets.filter((d) => d.data[i] !== null);
      expect(filled).toHaveLength(1);
    }
  });

  it("has one dataset per role that appears, in ROLE_ORDER, with the role style and no connecting line", () => {
    const config = buildBullwhipTrendConfig(NEWEST_FIRST);
    // ROLE_ORDER is retailer, wholesaler, distributor, factory; no distributor here.
    expect(config.data.datasets.map((d) => d.label)).toEqual([
      "Retailer",
      "Wholesaler",
      "Factory",
    ]);
    const retailer = config.data.datasets[0] as unknown as Record<
      string,
      unknown
    >;
    expect(retailer.showLine).toBe(false);
    expect(retailer.borderColor).toBe(roleStyle("RETAILER").colour);
    expect(retailer.pointStyle).toBe(roleStyle("RETAILER").point);
    const factory = config.data.datasets[2] as unknown as Record<
      string,
      unknown
    >;
    expect(factory.pointStyle).toBe(roleStyle("FACTORY").point);
  });

  it("leaves a null ratio out, never drawing it as 0 or 1 (criterion 2, failure mode 2)", () => {
    const config = buildBullwhipTrendConfig([
      match(3, "2026-10-03T10:00:00Z", "RETAILER", 2),
      match(2, "2026-10-02T10:00:00Z", "RETAILER", null),
      match(1, "2026-10-01T10:00:00Z", "RETAILER", 3),
    ]);
    expect(config.data.labels).toEqual([
      "2026-10-01T10:00:00Z",
      "2026-10-03T10:00:00Z",
    ]);
    expect(config.data.datasets).toHaveLength(1);
    expect(config.data.datasets[0].data).toEqual([3, 2]);
  });

  it("leaves a ratio of 0 out, since a log axis cannot place it", () => {
    const config = buildBullwhipTrendConfig([
      match(2, "2026-10-02T10:00:00Z", "FACTORY", 0),
      match(1, "2026-10-01T10:00:00Z", "FACTORY", 2),
    ]);
    expect(config.data.labels).toEqual(["2026-10-01T10:00:00Z"]);
    expect(config.data.datasets[0].data).toEqual([2]);
  });

  it("does not let an excluded game create a dataset for its role", () => {
    const config = buildBullwhipTrendConfig([
      match(2, "2026-10-02T10:00:00Z", "DISTRIBUTOR", null),
      match(1, "2026-10-01T10:00:00Z", "RETAILER", 2),
    ]);
    expect(config.data.datasets.map((d) => d.label)).toEqual(["Retailer"]);
  });

  it("does not mutate its input", () => {
    const input = [...NEWEST_FIRST];
    buildBullwhipTrendConfig(input);
    expect(input).toEqual(NEWEST_FIRST);
  });
});

describe("BullwhipTrend", () => {
  it("renders a titled chart with a table of date, role and ratio to two decimals", () => {
    render(<BullwhipTrend matches={NEWEST_FIRST} />);
    expect(
      screen.getByLabelText(/bullwhip ratio of each game/i, {
        selector: '[role="img"]:not(canvas)',
      }),
    ).toBeInTheDocument();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    // Oldest first.
    expect(rows[0]).toHaveTextContent("2026-10-01");
    expect(rows[0]).toHaveTextContent(/wholesaler/i);
    expect(rows[0]).toHaveTextContent("3.13");
    expect(rows[3]).toHaveTextContent("2026-10-04");
    expect(rows[3]).toHaveTextContent(/factory/i);
    expect(rows[3]).toHaveTextContent("4.50");
  });

  it('has a "Show table" toggle from the chart kit', () => {
    render(<BullwhipTrend matches={NEWEST_FIRST} />);
    expect(
      screen.getByRole("button", { name: /show table/i }),
    ).toBeInTheDocument();
  });

  it("says the trend covers the games on this page", () => {
    const { container } = render(<BullwhipTrend matches={NEWEST_FIRST} />);
    expect(container.textContent).toMatch(/this page/i);
  });

  it("leaves excluded games out of the table and counts each kind in the caption (criterion 2)", () => {
    const matches = [
      match(9, "2026-10-09T10:00:00Z", "RETAILER", 2),
      match(8, "2026-10-08T10:00:00Z", "RETAILER", null),
      match(7, "2026-10-07T10:00:00Z", "RETAILER", null),
      match(6, "2026-10-06T10:00:00Z", "FACTORY", 0),
      match(5, "2026-10-05T10:00:00Z", "FACTORY", 0),
      match(4, "2026-10-04T10:00:00Z", "FACTORY", 0),
      match(3, "2026-10-03T10:00:00Z", "FACTORY", 5),
    ];
    const { container } = render(<BullwhipTrend matches={matches} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const text = container.textContent ?? "";
    // Two had no ratio, three had a ratio of zero.
    expect(text).toMatch(/\b2\b/);
    expect(text).toMatch(/\b3\b/);
    expect(text).not.toMatch(/\b7\b/);
  });

  it("names no room code in its table or caption", () => {
    const { container } = render(<BullwhipTrend matches={NEWEST_FIRST} />);
    for (const m of NEWEST_FIRST)
      expect(container.textContent).not.toContain(m.room_code);
  });

  it.each([
    ["no games", []],
    ["one plottable game", [match(1, "2026-10-01T10:00:00Z", "RETAILER", 2)]],
    [
      "two games of which one is plottable",
      [
        match(2, "2026-10-02T10:00:00Z", "RETAILER", null),
        match(1, "2026-10-01T10:00:00Z", "RETAILER", 2),
      ],
    ],
    [
      "two games of which one has a zero ratio",
      [
        match(2, "2026-10-02T10:00:00Z", "RETAILER", 0),
        match(1, "2026-10-01T10:00:00Z", "RETAILER", 2),
      ],
    ],
  ])(
    "shows a sentence instead of a chart with %s (criterion 3)",
    (_name, matches) => {
      const { container } = render(<BullwhipTrend matches={matches} />);
      expect(
        screen.getByText(
          "Play at least two games with a bullwhip ratio to see a trend.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByLabelText(/bullwhip ratio of each game/i),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("table")).not.toBeInTheDocument();
      expect(container.querySelector("canvas")).toBeNull();
    },
  );

  it("shows the chart, not the sentence, with exactly two plottable games", () => {
    render(
      <BullwhipTrend
        matches={[
          match(2, "2026-10-02T10:00:00Z", "RETAILER", 3),
          match(1, "2026-10-01T10:00:00Z", "RETAILER", 2),
        ]}
      />,
    );
    expect(
      screen.queryByText(/play at least two games/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText(/bullwhip ratio of each game/i, {
        selector: '[role="img"]:not(canvas)',
      }),
    ).toBeInTheDocument();
  });
});
