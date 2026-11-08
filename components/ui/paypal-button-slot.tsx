/**
 * Where the PayPal JavaScript SDK renders its buttons. Roomover never draws
 * its own approve button, so until the SDK loads the slot shows this note.
 */
export function PayPalButtonSlot() {
  return (
    <div className="flex min-h-14 w-full max-w-md flex-col justify-center gap-1 rounded-md border-2 border-dashed border-stone px-4 py-3">
      <p className="text-sm font-semibold">Official PayPal buttons render here</p>
      <p className="text-xs text-flint">
        The PayPal JavaScript SDK v6 draws the PayPal and Pay Later buttons in this slot. Roomover never styles its own approve
        button.
      </p>
    </div>
  );
}
