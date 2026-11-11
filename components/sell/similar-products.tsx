import { formatUsdShort } from "@/lib/format";
import type { SellProductView } from "@/lib/sell/view";

/** Channel3 products the seller agent called similar, closest first, in the hairline rows the details use. */
export function SimilarProducts({ products }: { products: readonly SellProductView[] }) {
  return (
    <section aria-labelledby="similar-products-title" className="flex flex-col gap-2">
      <h3 id="similar-products-title" className="text-sm font-medium">
        Similar new items on Channel3
      </h3>
      <ul className="flex flex-col">
        {products.map((product) => (
          <li key={product.productId} className="flex items-baseline justify-between gap-4 border-t border-hair py-2.5 text-sm first:border-t-0 first:pt-0">
            <span className="flex min-w-0 flex-col">
              <span className="line-clamp-2 text-pretty">{product.title}</span>
              <span className="text-xs text-flint">{product.retailer}</span>
            </span>
            <span className="shrink-0 font-medium">{formatUsdShort(product.newPriceCents)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
