# Roomover

Turning move-out season into move-in opportunities.

Roomover is a campus marketplace that passes furniture and dorm essentials from students who move out at the end of a term to the students who move in next. Agents built on Anthropic's Claude models furnish the arriving student's room in a three dimensional view, and the student pays every seller with one checkout through the payments company PayPal. PayPal holds the money until a photo check at handoff confirms each item, and Roomover then pays each seller through PayPal Payouts.

## Disputes

A student who has a problem with an item after handoff opens a dispute in PayPal's Resolution Center. PayPal tells Roomover through a webhook, and the verifier agent reads the dispute, the PayPal order, and the disputed transaction with the read only tools of the PayPal Agent Toolkit, the library PayPal publishes for AI agents. Code decides from the dispute's status, stage, reason, and requested evidence whether PayPal is waiting for Roomover's evidence and which kind fits. Roomover answers through the PayPal Disputes API (application programming interface) with records it already holds. The buyer's own handoff photos and the listing photos go in first, followed by a handoff record that lists the verifier's photo comparison, the buyer's confirmation of the item, the agreed price and slot, every PayPal ID, and a timeline. The verifier adds one short note for PayPal's reviewer, and code rejects any note that names an amount outside those records. No agent can accept a claim, offer a refund, or move money.

The Handoff screen states each dispute in plain words, such as "Jordan opened a dispute about the chair. Roomover sent PayPal the photos and the handoff record." Under the hood lists the dispute ID, each Agent Toolkit read, and the evidence Roomover sent.

## Known limitations

- A dispute PayPal decides for the buyer leaves the seller's payout in place. In the sandbox demo the platform account absorbs the refund. A production version would hold back part of each payout until disputes close, or recover the amount from the seller.

Full documentation is in progress.
