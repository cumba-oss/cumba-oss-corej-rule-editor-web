import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { DerivedT } from "../../api/types";
import { stringifyYaml } from "../../util/yaml";
import { topLevelBlocks } from "./yamlPath";

/** The derived fields of the buffer's latest analysis and whether they are current. */
export interface DerivedView {
  derived: DerivedT | null;
  /** `none`: no analysis requested yet (no widgets); `pending` / `failed`: the widgets say stale. */
  status: "none" | "pending" | "ok" | "failed";
  showAuthorities: boolean;
}

export const EMPTY_DERIVED: DerivedView = { derived: null, status: "none", showAuthorities: false };

export const setDerived = StateEffect.define<DerivedView>();

/** Where the three widgets sit in the buffer, as the packaged shape would place the fields. */
export interface WidgetPositions {
  sensitivity: { pos: number; side: -1 | 1 };
  outputVariables: { pos: number; side: -1 | 1; indent: number };
  authorities: { pos: number; side: -1 | 1 };
}

export function widgetPositions(doc: string): WidgetPositions {
  const blocks = topLevelBlocks(doc);
  const block = (key: string) => blocks.find((b) => b.key === key);
  const after = (keys: string[]): { pos: number; side: -1 | 1 } | null => {
    for (const k of keys) {
      const b = block(k);
      if (b) return { pos: b.to, side: 1 };
    }
    return null;
  };
  const end = { pos: doc.length, side: 1 as const };
  const sensitivity = after(["Sensitivity", "Severity", "Description", "Core"]) ?? {
    pos: 0,
    side: -1,
  };
  const outcome = block("Outcome");
  const outputVariables = outcome
    ? { pos: outcome.to, side: 1 as const, indent: 2 }
    : { ...(after(["Check"]) ?? end), indent: 0 };
  const standards = block("Standards");
  const authorities = standards ? { pos: standards.from, side: -1 as const } : end;
  return { sensitivity, outputVariables, authorities };
}

function el(tag: string, text: string, style = ""): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = text;
  if (style) e.style.cssText = style;
  return e;
}

abstract class DerivedWidget extends WidgetType {
  constructor(
    readonly view: DerivedView,
    readonly indent: number,
  ) {
    super();
  }

  eq(other: DerivedWidget): boolean {
    return (
      other.constructor === this.constructor &&
      other.indent === this.indent &&
      other.view.status === this.view.status &&
      JSON.stringify(other.view.derived) === JSON.stringify(this.view.derived)
    );
  }

  ignoreEvent(): boolean {
    return true;
  }

  get stale(): boolean {
    return this.view.status !== "ok";
  }

  toDOM(): HTMLElement {
    const dom = document.createElement("div");
    dom.className = `cm-derived-widget${this.stale ? " cm-derived-stale" : ""}`;
    dom.setAttribute("role", "note");
    dom.setAttribute("aria-label", `${this.name} (generated, read-only)`);
    dom.contentEditable = "false";
    dom.style.cssText = [
      "font-family: var(--mantine-font-family-monospace)",
      "color: var(--mantine-color-dimmed)",
      "background: var(--mantine-color-default-hover)",
      `padding: 1px 4px 1px ${4 + this.indent * 7}px`,
      "user-select: none",
      this.stale ? "opacity: 0.55" : "",
    ].join(";");
    this.fill(dom);
    return dom;
  }

  protected header(label: string, notes: string[]): HTMLElement {
    const parts = [
      ...notes,
      ...(this.stale ? [this.view.status === "failed" ? "stale — analysis failed" : "stale"] : []),
    ];
    return el(
      "div",
      `${label}${parts.length ? `   # generated · ${parts.join(" · ")}` : "   # generated"}`,
    );
  }

  abstract get name(): string;

  protected abstract fill(dom: HTMLElement): void;
}

class SensitivityWidget extends DerivedWidget {
  get name(): string {
    return "Sensitivity";
  }

  protected fill(dom: HTMLElement): void {
    const d = this.view.derived;
    const value = d?.sensitivity ? `"${d.sensitivity}"` : "—";
    const notes = d ? [`confidence ${d.sensitivityConfidence ?? "?"}`] : ["no rule loaded"];
    const line = this.header(`Sensitivity: ${value}`, notes);
    if (d?.sensitivityRationale) line.title = d.sensitivityRationale;
    dom.appendChild(line);
  }
}

class OutputVariablesWidget extends DerivedWidget {
  get name(): string {
    return "Output_Variables";
  }

  protected fill(dom: HTMLElement): void {
    const ov = this.view.derived?.outputVariables;
    if (!ov) {
      dom.appendChild(this.header("Output_Variables: —", ["no rule loaded"]));
      return;
    }
    // `derived` is whether the rule loaded (P7 / L2 of the effective-output-variables plan): a rule
    // that failed to load has no derivation, so its list is the authored one, said in words.
    if (!ov.derived) {
      dom.appendChild(this.header("Output_Variables:", ["rule failed to load — list as authored"]));
      for (const name of ov.authored ?? []) dom.appendChild(el("div", `- "${name}"`));
      for (const name of ov.excluded ?? []) {
        dom.appendChild(el("div", `- "!${name}"   # excluded`, "text-decoration: line-through"));
      }
      return;
    }
    dom.appendChild(this.header("Output_Variables:", ["effective"]));
    const effective = ov.effective ?? [];
    if (effective.length === 0) {
      // P4: an empty effective list is not "reports nothing" — the run infers the Check's columns
      dom.appendChild(
        el("div", "# none listed — at run time the engine reports the columns the Check reads"),
      );
    }
    const authored = new Set(ov.authored ?? []);
    for (const name of effective) {
      const mark = authored.has(name) ? "   # authored" : "";
      const line = el("div", `- "${name}"${mark}`);
      if (authored.has(name)) line.style.color = "var(--mantine-color-text)";
      dom.appendChild(line);
    }
    for (const name of ov.excluded ?? []) {
      const line = el("div", `- "!${name}"   # excluded`, "text-decoration: line-through");
      dom.appendChild(line);
    }
  }
}

class AuthoritiesWidget extends DerivedWidget {
  get name(): string {
    return "Authorities";
  }

  protected fill(dom: HTMLElement): void {
    const tree = this.view.derived?.authorities;
    dom.appendChild(this.header("Authorities:", tree ? [] : ["no rule loaded"]));
    if (tree) {
      const body = stringifyYaml(tree)
        .split("\n")
        .filter((l) => l.length)
        .map((l) => `  ${l}`)
        .join("\n");
      dom.appendChild(el("pre", body, "margin: 0; font: inherit; white-space: pre-wrap"));
    }
  }
}

function decorationsOf(doc: string, view: DerivedView): DecorationSet {
  if (view.status === "none") return Decoration.none;
  const p = widgetPositions(doc);
  const ranges = [
    Decoration.widget({
      widget: new SensitivityWidget(view, 0),
      block: true,
      side: p.sensitivity.side,
    }).range(p.sensitivity.pos),
    Decoration.widget({
      widget: new OutputVariablesWidget(view, p.outputVariables.indent),
      block: true,
      side: p.outputVariables.side,
    }).range(p.outputVariables.pos),
  ];
  if (view.showAuthorities) {
    ranges.push(
      Decoration.widget({
        widget: new AuthoritiesWidget(view, 0),
        block: true,
        side: p.authorities.side,
      }).range(p.authorities.pos),
    );
  }
  return Decoration.set(ranges, true);
}

const derivedField = StateField.define<{ view: DerivedView; decorations: DecorationSet }>({
  create: () => ({ view: EMPTY_DERIVED, decorations: Decoration.none }),
  update(value, tr) {
    let view = value.view;
    let changed = tr.docChanged;
    for (const e of tr.effects) {
      if (e.is(setDerived)) {
        view = e.value;
        changed = true;
      }
    }
    if (!changed) return value;
    return { view, decorations: decorationsOf(tr.state.doc.toString(), view) };
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

/**
 * The greyed generated fields of PLAN-rule-editor §5.4 (O5): `Sensitivity` and `Output_Variables`
 * as read-only block widgets where the packaged shape would place them, `Authorities` the same
 * but only on request. Widgets are not part of the document — never saved, never copied, line
 * numbers stay true — and dim with "stale" while the analysis is pending or failed. Update with
 * `view.dispatch({ effects: setDerived.of(view) })`.
 */
export function derivedWidgets(): Extension {
  return derivedField;
}
