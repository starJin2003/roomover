import type { PayoutRecipientType, PayoutWallet } from "./enums";

export interface SellerAccount {
  /** The payer ID from Log in with PayPal. */
  paypalAccountId: string | null;
  paypalEmail: string | null;
  payoutWallet: PayoutWallet;
  venmoHandle: string | null;
}

export interface PayoutRecipient {
  recipientType: PayoutRecipientType;
  receiver: string;
  wallet: PayoutWallet;
}

/**
 * Where a seller's payout goes. A seller who logged in with PayPal is paid to
 * the payer ID PayPal gave Roomover, which follows the account even when its
 * email changes. Seeded sellers who never logged in are paid to their sandbox
 * email. A Venmo wallet with a handle goes to Venmo. Null when the seller has
 * no way to be paid.
 */
export function payoutRecipient(seller: SellerAccount): PayoutRecipient | null {
  if (seller.payoutWallet === "venmo" && seller.venmoHandle !== null) return { recipientType: "USER_HANDLE", receiver: seller.venmoHandle, wallet: "venmo" };
  if (seller.paypalAccountId !== null) return { recipientType: "PAYPAL_ID", receiver: seller.paypalAccountId, wallet: "paypal" };
  if (seller.paypalEmail !== null) return { recipientType: "EMAIL", receiver: seller.paypalEmail, wallet: "paypal" };
  return null;
}
