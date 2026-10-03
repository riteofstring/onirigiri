import type {
  OnirigiriPaneDefinition,
  OpenPaneRequest,
  WorkspacePane,
} from "@riteofstring/onirigiri";
import {
  memo,
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export type DemoKind =
  "atlas" | "mixer" | "notes" | "signals" | "system" | "tasks";

interface DemoDefinition {
  subtitle: string;
  title: string;
  tone: OnirigiriPaneDefinition["tone"];
}

export const demoDefinitions: Record<DemoKind, DemoDefinition> = {
  atlas: { subtitle: "live route topology", title: "Atlas", tone: "cyan" },
  mixer: {
    subtitle: "generative soundscape",
    title: "Field mixer",
    tone: "pink",
  },
  notes: { subtitle: "local draft", title: "Field notes", tone: "orange" },
  signals: {
    subtitle: "12 sources streaming",
    title: "Signal lab",
    tone: "green",
  },
  system: { subtitle: "service health", title: "System map", tone: "cyan" },
  tasks: {
    subtitle: "today · 4 remaining",
    title: "Focus board",
    tone: "orange",
  },
};

const demoOrder: readonly DemoKind[] = [
  "mixer",
  "system",
  "atlas",
  "tasks",
  "signals",
  "notes",
];

export function requestForDemo(kind: DemoKind): OpenPaneRequest {
  return {
    data: { demoKind: kind },
    surfaceKind: kind,
    ...demoDefinitions[kind],
  };
}

export const DemoPane = memo(function DemoPane({
  focused,
  onChoose,
  pane,
}: {
  focused: boolean;
  onChoose: (paneId: string, kind: DemoKind) => void;
  pane: WorkspacePane;
}) {
  let content: ReactNode;
  switch (pane.surfaceKind) {
    case "atlas":
      content = <AtlasPanel />;
      break;
    case "mixer":
      content = <MixerPanel />;
      break;
    case "notes":
      content = <NotesPanel focused={focused} />;
      break;
    case "signals":
      content = <SignalsPanel />;
      break;
    case "system":
      content = <SystemPanel />;
      break;
    case "tasks":
      content = <TasksPanel />;
      break;
    default:
      content = <EmptyPanel onChoose={(kind) => onChoose(pane.paneId, kind)} />;
  }
  return <div className="demo-pane-body">{content}</div>;
});

const signalValues = [
  45, 78, 39, 91, 63, 72, 54, 84, 48, 67, 95, 58, 76, 42, 88, 61, 70, 51,
];

function SignalsPanel() {
  return (
    <div className="demo-panel signal-panel">
      <div className="demo-kpis">
        <Metric label="Throughput" trend="+8.4%" value="18.2k" />
        <Metric label="P95 latency" trend="−12ms" value="84ms" />
        <Metric label="Uptime" trend="30 days" value="99.98%" />
      </div>
      <div aria-hidden="true" className="signal-chart">
        {signalValues.map((value, index) => (
          <span key={index} style={{ height: `${value}%` }} />
        ))}
      </div>
      <div className="signal-legend">
        <span>
          <i aria-hidden="true" className="signal-legend__live" />
          Sample traffic
        </span>
        <span>18 intervals</span>
      </div>
    </div>
  );
}

function Metric({
  label,
  trend,
  value,
}: {
  label: string;
  trend: string;
  value: string;
}) {
  return (
    <div className="demo-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{trend}</small>
    </div>
  );
}

function TasksPanel() {
  const [tasks, setTasks] = useState([
    { done: true, label: "Review motion primitives" },
    { done: false, label: "Prototype compact layout" },
    { done: false, label: "Test keyboard navigation" },
    { done: false, label: "Publish canary package" },
  ]);
  const completed = tasks.filter((task) => task.done).length;
  return (
    <div className="demo-panel task-panel">
      <div className="task-progress">
        <span>Release checklist</span>
        <strong>
          {completed}/{tasks.length}
        </strong>
        <div aria-hidden="true">
          <i style={{ width: `${(completed / tasks.length) * 100}%` }} />
        </div>
      </div>
      <ul className="task-list">
        {tasks.map((task, index) => (
          <li key={task.label} data-done={task.done ? "true" : "false"}>
            <label>
              <input
                checked={task.done}
                onChange={() => {
                  setTasks((current) =>
                    current.map((candidate, candidateIndex) =>
                      candidateIndex === index
                        ? { ...candidate, done: !candidate.done }
                        : candidate,
                    ),
                  );
                }}
                type="checkbox"
              />
              <span>{task.label}</span>
            </label>
            <small>{index < 2 ? "Today" : "Next"}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NotesPanel({ focused }: { focused: boolean }) {
  const noteId = useId();
  const [note, setNote] = useState(
    "A spatial interface should feel calm even when the work is complex.\n\nKeep the host in control of content. Let Onirigiri handle movement, focus, and geometry.",
  );
  return (
    <div className="demo-panel notes-panel">
      <div className="notes-meta">
        <label htmlFor={noteId}>
          {focused ? "Field notes · ready to edit" : "Field notes"}
        </label>
        <span>{note.length} characters</span>
      </div>
      <textarea
        id={noteId}
        onChange={(event) => {
          setNote(event.target.value);
        }}
        spellCheck="true"
        value={note}
      />
    </div>
  );
}

function AtlasPanel() {
  const [selected, setSelected] = useState("Portland");
  const places = [
    { label: "Portland", left: 18, top: 34 },
    { label: "Reykjavík", left: 47, top: 20 },
    { label: "Lisbon", left: 58, top: 55 },
    { label: "Kyoto", left: 84, top: 42 },
  ];
  return (
    <div className="demo-panel atlas-panel">
      <div className="atlas-map">
        <svg aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 100 70">
          <path
            d="M2 54C19 18 31 59 47 22S70 61 98 17"
            fill="none"
            stroke="color-mix(in oklch, var(--playground-text-secondary) 48%, transparent)"
            strokeDasharray="1.5 2.2"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d="M0 23C20 52 39 8 61 35S83 24 100 49"
            fill="none"
            stroke="color-mix(in oklch, var(--playground-text-secondary) 48%, transparent)"
            strokeDasharray="1.5 2.2"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {places.map((place) => (
          <button
            aria-label={`Select ${place.label}`}
            aria-pressed={selected === place.label}
            className="atlas-point"
            data-selected={selected === place.label ? "true" : "false"}
            key={place.label}
            onClick={() => {
              setSelected(place.label);
            }}
            style={{ left: `${place.left}%`, top: `${place.top}%` }}
            type="button"
          >
            <i aria-hidden="true" />
            <span>{place.label}</span>
          </button>
        ))}
      </div>
      <div className="atlas-footer">
        <span>
          <small>Selected node</small>
          <strong>{selected}</strong>
        </span>
        <span>
          <small>Round trip</small>
          <strong>42 ms</strong>
        </span>
        <span>
          <small>Route health</small>
          <strong className="atlas-healthy">Excellent</strong>
        </span>
      </div>
    </div>
  );
}

function SystemPanel() {
  const services = [
    { health: 98, label: "Gateway", status: "Nominal" },
    { health: 91, label: "Layout worker", status: "Nominal" },
    { health: 76, label: "Snapshot cache", status: "Warm" },
    { health: 100, label: "Event stream", status: "Nominal" },
  ];
  return (
    <div className="demo-panel system-panel">
      <div className="system-orbit" aria-hidden="true">
        <span className="system-orbit__core">N</span>
        <i />
        <i />
        <i />
      </div>
      <div className="system-services">
        {services.map((service) => (
          <div key={service.label}>
            <span>
              <i
                aria-hidden="true"
                data-warm={service.status === "Warm" ? "true" : "false"}
              />
              {service.label}
            </span>
            <small>{service.status}</small>
            <strong>{service.health}%</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

const mixerTracks = [
  { initialLevel: 68, label: "Rain" },
  { initialLevel: 42, label: "Tape" },
  { initialLevel: 81, label: "Pines" },
  { initialLevel: 56, label: "Night" },
] as const;

function MixerPanel() {
  const [levels, setLevels] = useState<number[]>(() =>
    mixerTracks.map((track) => track.initialLevel),
  );
  return (
    <div className="demo-panel mixer-panel">
      <div className="mixer-visual" aria-hidden="true">
        {Array.from({ length: 34 }, (_, index) => (
          <i
            key={index}
            style={{
              height: `${14 + Math.abs(Math.sin(index * 0.72)) * 74}%`,
              opacity: 0.35 + (index % 5) * 0.11,
            }}
          />
        ))}
      </div>
      <div className="mixer-controls">
        {mixerTracks.map((track, index) => {
          const level = levels[index] ?? track.initialLevel;
          return (
            <label key={track.label}>
              <span>{track.label}</span>
              <input
                max="100"
                min="0"
                onChange={(event) => {
                  setLevels((current) =>
                    current.map((value, valueIndex) =>
                      valueIndex === index ? Number(event.target.value) : value,
                    ),
                  );
                }}
                style={{ "--level": `${level}%` } as CSSProperties}
                type="range"
                value={level}
              />
              <strong>{level}</strong>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function EmptyPanel({ onChoose }: { onChoose: (kind: DemoKind) => void }) {
  return (
    <div className="demo-panel empty-panel">
      <span aria-hidden="true" className="empty-panel__mark">
        ＋
      </span>
      <strong>Choose something to explore</strong>
      <p>
        Split panes begin empty so the host application can decide what belongs
        in them.
      </p>
      <div>
        {demoOrder.slice(0, 4).map((kind) => (
          <button
            key={kind}
            onClick={() => {
              onChoose(kind);
            }}
            type="button"
          >
            {demoDefinitions[kind].title}
          </button>
        ))}
      </div>
    </div>
  );
}
