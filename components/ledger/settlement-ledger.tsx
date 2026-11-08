import { sumCents } from "@/lib/domain/money";
import { formatUsd, formatUsdChange } from "@/lib/format";

export interface LedgerRow {
  readonly account: string;
  readonly detail: string;
  readonly beforeCents: number;
  readonly afterCents: number;
}

interface SettlementLedgerProps {
  title: string;
  subtitle: string;
  rows: readonly LedgerRow[];
  footnote: string;
}

function Change({ cents }: { cents: number }) {
  if (cents === 0) return <span className="text-flint">{formatUsdChange(cents)}</span>;
  return <span className="rounded-sm bg-blue px-1.5 py-0.5 font-semibold whitespace-nowrap">{formatUsdChange(cents)}</span>;
}

const CELL = "py-3 align-top tabular-nums";

/** Balances before and after one settlement. The totals match because money only changes hands. */
export function SettlementLedger({ title, subtitle, rows, footnote }: SettlementLedgerProps) {
  const before = sumCents(rows.map((row) => row.beforeCents));
  const after = sumCents(rows.map((row) => row.afterCents));
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-stone/50 p-4 sm:p-6">
      <header className="flex flex-col gap-0.5">
        <h3 className="text-lg font-bold text-navy">{title}</h3>
        <p className="text-sm text-flint">{subtitle}</p>
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone text-left text-xs text-flint">
            <th scope="col" className="pb-2 font-semibold">
              Account
            </th>
            <th scope="col" className="pb-2 pl-2 text-right font-semibold">
              Before
            </th>
            <th scope="col" className="pb-2 pl-2 text-right font-semibold">
              After
            </th>
            <th scope="col" className="pb-2 pl-2 text-right font-semibold">
              Change
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone/30">
          {rows.map((row) => (
            <tr key={row.account}>
              <th scope="row" className={`${CELL} text-left font-normal`}>
                <span className="block font-semibold">{row.account}</span>
                <span className="block text-xs text-flint">{row.detail}</span>
              </th>
              <td className={`${CELL} pl-2 text-right text-flint`}>{formatUsd(row.beforeCents)}</td>
              <td className={`${CELL} pl-2 text-right font-semibold`}>{formatUsd(row.afterCents)}</td>
              <td className={`${CELL} pl-2 text-right`}>
                <Change cents={row.afterCents - row.beforeCents} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-stone">
            <th scope="row" className={`${CELL} text-left font-semibold`}>
              Total
            </th>
            <td className={`${CELL} pl-2 text-right text-flint`}>{formatUsd(before)}</td>
            <td className={`${CELL} pl-2 text-right font-semibold`}>{formatUsd(after)}</td>
            <td className={`${CELL} pl-2 text-right`}>
              <Change cents={after - before} />
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="text-xs text-flint">{footnote}</p>
    </section>
  );
}
