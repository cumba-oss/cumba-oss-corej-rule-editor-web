import { useCallback, useEffect, useMemo, useRef } from "react";
import { Box, useComputedColorScheme } from "@mantine/core";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { foldEffect } from "@codemirror/language";
import {
  forEachDiagnostic,
  lintGutter,
  linter,
  setDiagnostics,
  type Diagnostic as CmDiagnostic,
} from "@codemirror/lint";
import { yaml } from "@codemirror/lang-yaml";
import { topLevelKeyRange } from "../util/yamlFold";
import {
  derivedWidgets,
  EMPTY_DERIVED,
  setDerived,
  type DerivedView,
} from "./editor/derivedWidgets";
import { EMPTY_CONTEXT, type EngineContext } from "./editor/engineContext";
import { ruleCompletion } from "./editor/ruleCompletion";
import { ruleTooltips } from "./editor/ruleTooltips";
import { jsonFolding } from "./editor/jsonFold";
import { yamlListExtensions } from "./editor/yamlListEditing";
import { codeTheme } from "../brand/codeTheme";

/** An inline editor marker (red/orange/blue squiggle) at a character range. */
export interface EditorMarker {
  from: number;
  to: number;
  severity: "error" | "warning" | "info";
  message: string;
}

interface Props {
  /** Accessible name of the editor region (the tab's title). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Ctrl+S / Cmd+S. The editor swallows the key so the browser does not open its save dialog. */
  onSave?: () => void;
  /**
   * `yaml`: syntax highlighting + fold gutter + list keymap; `json`: bracket folding (the
   * read-only report); omit for plain text (`.cdt`).
   */
  language?: "yaml" | "json";
  readOnly?: boolean;
  /** Top-level YAML keys to fold once when {@link foldTrigger} changes (e.g. `["Authorities"]`). */
  initialFoldKeys?: string[];
  /** Re-applies the initial fold whenever this value changes, without folding on every edit. */
  foldTrigger?: number | string;
  /**
   * Inline diagnostic markers (lint gutter + underlines). `null` keeps the markers the editor
   * already shows, mapped through the edits since — for an analysis that is pending or failed,
   * whose ranges describe other text.
   */
  markers?: EditorMarker[] | null;
  /**
   * The engine context for completion and tooltips (rule tabs). Its presence switches both on;
   * the value is read lazily so a new context never rebuilds the extension set.
   */
  engine?: EngineContext;
  /** The greyed generated fields (rule tabs): rendered as block widgets, never part of the document. */
  derived?: DerivedView;
  /** Select and scroll to a range (a Problems-tab click); `seq` makes a repeat request fire again. */
  reveal?: { from: number; to: number; seq: number };
}

/** Markers as CodeMirror diagnostics, clamped to the document (one past the end is dropped). */
function toDiagnostics(len: number, markers: EditorMarker[]): CmDiagnostic[] {
  return markers
    .filter((m) => m.from <= len)
    .map((m) => ({
      from: Math.min(m.from, len),
      to: Math.min(m.to, len),
      severity: m.severity,
      message: m.message,
    }));
}

/** The diagnostics the editor shows now, at their mapped positions. */
function currentDiagnostics(state: EditorView["state"]): CmDiagnostic[] {
  const out: CmDiagnostic[] = [];
  forEachDiagnostic(state, (d, from, to) => out.push({ ...d, from, to }));
  return out;
}

/**
 * The CodeMirror 6 editor of PLAN-rule-editor §5.4: YAML highlighting and folding (`yamlFold`),
 * the list-continuation keymap (`yamlListEditing`), a lint gutter fed by {@link EditorMarker}s
 * (the engine's diagnostics through `markersOf`), and — when an {@link EngineContext} is given —
 * schema / catalogue completion, hover tooltips and the greyed generated-field widgets.
 */
export function CodeEditor({
  label,
  value,
  onChange,
  onSave,
  language,
  readOnly,
  initialFoldKeys,
  foldTrigger,
  markers,
  engine,
  derived,
  reveal,
}: Props) {
  // The COMPUTED scheme: under "auto" useMantineColorScheme() answers "auto", never "dark"; the
  // initial value is read synchronously so the editor never renders light first and flips.
  const colorScheme = useComputedColorScheme("light", { getInitialValueInEffect: false });
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const withEngine = engine !== undefined;
  // Latest-value refs read by the once-built (stable) linter and save keymap below, so the
  // CodeMirror extension set never has to be rebuilt — which would reconfigure the editor and
  // reset the initial fold — when markers / onSave change. The reads happen inside callbacks that
  // run after render (lint pass, key press), not during render; react-hooks/refs can't see that,
  // hence the scoped suppressions.
  const markersRef = useRef<EditorMarker[] | null>([]);
  const onSaveRef = useRef<(() => void) | undefined>(undefined);
  const engineRef = useRef<EngineContext>(EMPTY_CONTEXT);
  useEffect(() => {
    markersRef.current = markers === undefined ? [] : markers;
  }, [markers]);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);
  useEffect(() => {
    engineRef.current = engine ?? EMPTY_CONTEXT;
  }, [engine]);

  /* eslint-disable react-hooks/refs -- the two refs below are read inside CodeMirror callbacks
     (the lint pass, the key press), which run after render; the rule cannot see that. */
  const lintSource = useMemo(
    () =>
      linter((view) =>
        markersRef.current === null
          ? currentDiagnostics(view.state)
          : toDiagnostics(view.state.doc.length, markersRef.current),
      ),
    [],
  );

  const saveKeymap = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              onSaveRef.current?.();
              return true;
            },
          },
        ]),
      ),
    [],
  );
  const engineExtensions = useMemo(
    () => [
      ruleCompletion(() => engineRef.current),
      ruleTooltips(() => engineRef.current),
      derivedWidgets(),
    ],
    [],
  );
  /* eslint-enable react-hooks/refs */

  // Stable extension set so react-codemirror does not reconfigure on every keystroke / re-render.
  const extensions = useMemo(
    () =>
      language === "yaml"
        ? [
            yaml(),
            EditorView.lineWrapping,
            lintSource,
            lintGutter(),
            yamlListExtensions(),
            saveKeymap,
            ...(withEngine ? engineExtensions : []),
          ]
        : language === "json"
          ? [EditorView.lineWrapping, lintSource, lintGutter(), saveKeymap, jsonFolding()]
          : [EditorView.lineWrapping, lintSource, lintGutter(), saveKeymap],
    [language, lintSource, saveKeymap, withEngine, engineExtensions],
  );

  // The view is created by react-codemirror's own effect and reaches the ref one render later, so
  // the derived view and a reveal are applied both when their props change and when the view is
  // created (`onCreateEditor`), from refs that hold the latest values.
  const derivedRef = useRef<DerivedView | undefined>(undefined);
  const revealRef = useRef<Props["reveal"]>(undefined);
  const applyReveal = (view: EditorView, r: NonNullable<Props["reveal"]>) => {
    const len = view.state.doc.length;
    const from = Math.min(r.from, len);
    const to = Math.min(Math.max(r.to, from), len);
    view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
    view.focus();
  };
  useEffect(() => {
    revealRef.current = reveal;
    const view = cmRef.current?.view;
    if (view && reveal) applyReveal(view, reveal);
  }, [reveal]);

  // Push the derived view into the widget field whenever it changes (the document may still be
  // syncing right after mount, so a view without the field yet is simply skipped — the next
  // change re-dispatches).
  useEffect(() => {
    derivedRef.current = derived;
    const view = cmRef.current?.view;
    if (!view || !withEngine) return;
    view.dispatch({ effects: setDerived.of(derived ?? EMPTY_DERIVED) });
  }, [derived, withEngine]);
  const onCreateEditor = useCallback(
    (view: EditorView) => {
      if (withEngine)
        view.dispatch({ effects: setDerived.of(derivedRef.current ?? EMPTY_DERIVED) });
      if (markersRef.current?.length) {
        view.dispatch(
          setDiagnostics(view.state, toDiagnostics(view.state.doc.length, markersRef.current)),
        );
      }
      if (revealRef.current) applyReveal(view, revealRef.current);
    },
    [withEngine],
  );

  // Set the diagnostics whenever the markers change. (`forceLinting` only hurries a lint pass
  // that is already queued by a document change, so markers that arrive later — an analysis
  // answering after the lint delay — would never show; setting them directly cannot race.)
  useEffect(() => {
    const view = cmRef.current?.view;
    if (view && markers !== null) {
      view.dispatch(
        setDiagnostics(view.state, toDiagnostics(view.state.doc.length, markers ?? [])),
      );
    }
  }, [markers]);

  // Fold the requested top-level blocks once per load (when foldTrigger changes), not on every
  // edit. The view's document can be briefly empty right after mount, so retry on animation
  // frames until the document has synced — guarding each range against the live document length
  // so a fold is never dispatched out of range.
  useEffect(() => {
    if (!initialFoldKeys?.length) return undefined;
    let raf = 0;
    let attempts = 0;
    const applyFold = () => {
      const view = cmRef.current?.view;
      const len = view ? view.state.doc.length : 0;
      if (!view || len === 0) {
        if (attempts++ < 30) raf = requestAnimationFrame(applyFold);
        return;
      }
      const effects = initialFoldKeys
        .map((key) => topLevelKeyRange(value, key))
        .filter((r): r is [number, number] => r !== null && r[1] <= len)
        .map(([from, to]) => foldEffect.of({ from, to }));
      if (effects.length) view.dispatch({ effects });
    };
    raf = requestAnimationFrame(applyFold);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldTrigger]);

  return (
    <Box
      role="region"
      aria-label={label}
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
    >
      <CodeMirror
        ref={cmRef}
        onCreateEditor={onCreateEditor}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        theme={codeTheme(colorScheme)}
        height="100%"
        style={{ flex: 1, minHeight: 0, overflow: "auto" }}
        extensions={extensions}
        basicSetup={{
          lineNumbers: true,
          foldGutter: language !== undefined,
          highlightActiveLine: true,
          highlightActiveLineGutter: false,
          // Completion arrives with the authoring API (phase 3); off until then.
          autocompletion: false,
        }}
      />
    </Box>
  );
}
