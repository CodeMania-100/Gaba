"use client";

import { JsonRecord, PetahTikvaWorkspace } from "@/lib/api";
import {
  COMPETITOR_ROLE_LABELS,
  competitorRecordRole,
  LANE_LABELS,
  ROOM_FAMILY_LABELS,
  translateWarning,
} from "@/lib/family";
import { dateIL, ils, num } from "@/lib/format";

const QA_STATUS_LABELS: Record<string, string> = {
  usable: "תקין",
  low_confidence: "ביטחון נמוך",
  ambiguous: "דו-משמעי",
  rejected: "נפסל",
};

interface Props {
  workspace: PetahTikvaWorkspace;
  family: "3R" | "5R";
  lane: "sold" | "current_asking" | "new_development";
  onClose: () => void;
}

export default function EvidenceDetailModal({ workspace, family, lane, onClose }: Props) {
  const info = LANE_LABELS[lane];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <div className="mt-8 w-full max-w-5xl rounded-lg bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {info.title} — דירות {ROOM_FAMILY_LABELS[family] ?? family}
            </h2>
            <p className="text-xs text-slate-400">{info.subtitle}</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            סגירה ✕
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto px-6 py-4">
          {lane === "sold" && <SoldTable workspace={workspace} family={family} />}
          {lane === "current_asking" && <AskingTable workspace={workspace} family={family} />}
          {lane === "new_development" && <CompetitorTable workspace={workspace} family={family} />}
        </div>
      </div>
    </div>
  );
}

function SoldTable({ workspace, family }: { workspace: PetahTikvaWorkspace; family: "3R" | "5R" }) {
  const section = workspace.evidence_provenance.sold[family];
  const records = (section?.records as JsonRecord[]) ?? [];
  return (
    <div className="flex flex-col gap-3">
      <FunnelStrip funnel={section?.funnel} />
      <p className="text-xs text-slate-500">{records.length} רשומות עסקה (כולל שנפסלו/בבדיקה — status QA לכל שורה)</p>
      <Table
        head={["תאריך", "כתובת", "חדרים", "שטח", "מחיר ששולם", "₪/מ״ר", "גוש/חלקה", "סטטוס QA"]}
        rows={records.map((r) => [
          dateIL(r.event_date),
          r.address ?? "—",
          num(r.rooms, 0),
          num(r.area),
          ils(r.price),
          r.price_per_sqm != null ? num(r.price_per_sqm, 0) : "—",
          [r.gush, r.helka].filter(Boolean).join("/") || "—",
          <QaBadge key="qa" status={r.quality_status} reasons={r.quality_reasons} />,
        ])}
      />
    </div>
  );
}

function AskingTable({ workspace, family }: { workspace: PetahTikvaWorkspace; family: "3R" | "5R" }) {
  const section = workspace.evidence_provenance.current_asking[family];
  const accepted = (section?.accepted_records as JsonRecord[]) ?? [];
  const rejected = (section?.rejected_records as JsonRecord[]) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">נכללות בטווח ({accepted.length})</h3>
        <Table
          head={["כתובת", "שטח", "מחיר מבוקש", "₪/מ״ר", "קומה", "מקור"]}
          rows={accepted.map((r) => [
            r.address ?? "—",
            num(r.area),
            ils(r.asking_price),
            r.asking_ppsm != null ? num(r.asking_ppsm, 0) : "—",
            r.floor ?? "—",
            r.url ? (
              <a key="url" href={r.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                מדלן ↗
              </a>
            ) : (
              "—"
            ),
          ])}
        />
      </div>
      {rejected.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-slate-500">{rejected.length} רשומות נבדקו ולא נכללו</summary>
          <div className="mt-2">
            <Table
              head={["כתובת", "שטח", "מחיר מבוקש", "סיבת אי-הכללה"]}
              rows={rejected.slice(0, 30).map((r) => [
                r.address ?? "—",
                num(r.area),
                ils(r.asking_price),
                (r.exclusion_reasons as string[] | undefined)?.join(", ") ?? "—",
              ])}
            />
          </div>
        </details>
      )}
    </div>
  );
}

function CompetitorTable({ workspace, family }: { workspace: PetahTikvaWorkspace; family: "3R" | "5R" }) {
  const section = workspace.evidence_provenance.new_development[family];
  const records = (section?.records as JsonRecord[]) ?? [];
  const verified = records.filter((r) => r.field_provenance);

  const familyData = workspace.families.find((f) => f.family === family);
  const contributorSourceIds = new Set<string>(
    (familyData?.evidence_lanes.new_development.primary_contributors ?? []).flatMap(
      (c: JsonRecord) => (c.source_ids as string[]) ?? []
    )
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-500">
        כל {records.length} הרשומות מוצגות, כולל רשומות שמשמשות להשוואה בלבד ולא נכנסו לחישוב הטווח.
      </p>
      <Table
        head={["פרויקט", "יזם", "חדרים", "שטח", "מחיר", "₪/מ״ר", "תפקיד בטווח", "הערה"]}
        rows={records.map((r) => [
          <span key="name">
            {r.project_name ?? "—"}
            {r.field_provenance && <span className="ms-1 rounded bg-blue-50 px-1 py-0.5 text-[10px] text-blue-700">שדה מאומת</span>}
          </span>,
          r.developer ?? "—",
          num(r.rooms, 0),
          r.area_sqm != null ? num(r.area_sqm) : r.area_min_sqm != null ? `${num(r.area_min_sqm)}–${num(r.area_max_sqm)} (טווח)` : "—",
          ils(r.price_ils),
          r.ppsm != null ? num(r.ppsm, 0) : "—",
          <RoleBadge key="role" role={competitorRecordRole(r, contributorSourceIds)} />,
          (r.warnings as string[] | undefined)?.[0] ? translateWarning((r.warnings as string[])[0]) : "—",
        ])}
      />

      {verified.length > 0 && (
        <div>
          <h4 className="mb-2 mt-1 text-sm font-semibold text-slate-900">אימות ברמת שדה — Field-level source verification</h4>
          <div className="flex flex-col gap-2">
            {verified.map((r, i) => (
              <FieldProvenanceCard key={i} record={r} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FieldProvenanceCard({ record }: { record: JsonRecord }) {
  const fp = record.field_provenance as JsonRecord;
  return (
    <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs">
      <div className="mb-1 font-semibold text-blue-900">{record.project_name}</div>
      <div className="grid gap-1 sm:grid-cols-2">
        {Object.entries(fp).map(([field, info]) => {
          if (field === "disagreement_notes") return null;
          const i = info as JsonRecord;
          return (
            <div key={field} className="rounded bg-white px-2 py-1">
              <span className="font-medium text-slate-800">{field}</span>: {typeof i.value === "object" ? JSON.stringify(i.value) : String(i.value)}
              <div className="text-slate-500">
                מקור: {i.source}
                {i.retrieved_at && <> · {i.retrieved_at}</>}
                {i.developer_verification && <> · אימות יזם: {i.developer_verification}</>}
              </div>
            </div>
          );
        })}
      </div>
      {fp.disagreement_notes && (
        <ul className="mt-1 list-inside list-disc text-amber-800">
          {(fp.disagreement_notes as string[]).map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FunnelStrip({ funnel }: { funnel?: JsonRecord }) {
  if (!funnel) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded bg-slate-50 px-3 py-2 text-xs text-slate-600">
      {Object.entries(funnel).map(([k, v]) => (
        <span key={k}>
          {k}: <span className="font-medium text-slate-800">{String(v)}</span>
        </span>
      ))}
    </div>
  );
}

function QaBadge({ status, reasons }: { status: string; reasons?: string[] }) {
  const colors: Record<string, string> = {
    usable: "bg-emerald-100 text-emerald-800",
    low_confidence: "bg-amber-100 text-amber-900",
    ambiguous: "bg-orange-100 text-orange-900",
    rejected: "bg-red-100 text-red-800",
  };
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-medium ${colors[status] ?? "bg-slate-100 text-slate-700"}`}
      title={reasons?.join(", ")}
    >
      {QA_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function RoleBadge({ role }: { role: ReturnType<typeof competitorRecordRole> }) {
  const colors: Record<string, string> = {
    contributed: "bg-emerald-100 text-emerald-800",
    context: "bg-slate-100 text-slate-700",
    nearby: "bg-amber-100 text-amber-900",
    missing_area: "bg-orange-100 text-orange-900",
  };
  return <span className={`w-fit rounded px-1.5 py-0.5 text-xs font-medium ${colors[role]}`}>{COMPETITOR_ROLE_LABELS[role]}</span>;
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded border border-slate-200">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 text-start font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="px-3 py-4 text-center text-slate-400" colSpan={head.length}>
                אין רשומות
              </td>
            </tr>
          )}
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-slate-100">
              {row.map((cell, j) => (
                <td key={j} className="whitespace-nowrap px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
