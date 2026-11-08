/** Label and value rows, such as the details the photo filled in on Sell. */
export function FactList({ facts }: { facts: readonly { label: string; value: string }[] }) {
  return (
    <dl className="flex flex-col">
      {facts.map((fact) => (
        <div key={fact.label} className="flex items-baseline justify-between gap-4 border-t border-hair py-3 text-sm first:border-t-0 first:pt-0">
          <dt className="text-flint">{fact.label}</dt>
          <dd className="text-right font-medium">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
