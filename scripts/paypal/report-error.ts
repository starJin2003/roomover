import { PayPalApiError } from "@/lib/paypal/errors";

/** Prints a script failure without request bodies, tokens, or connection strings. */
export function reportScriptError(error: unknown): void {
  if (error instanceof PayPalApiError) {
    console.error(
      `PayPal error on ${error.operation}: ${error.status} ${error.errorName}. ${error.message} (debug ID ${error.debugId ?? "none"})`,
    );
    for (const detail of error.details) console.error(`  ${detail.issue}: ${detail.description ?? ""}`);
  } else {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : "Unknown failure";
    console.error(message.replace(/postgres(?:ql)?:\/\/\S+/g, "<database url>"));
  }
  process.exitCode = 1;
}
