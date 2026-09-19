import type { ReactElement } from 'react'
import ManualCallout from '../components/manual/ManualCallout'
import ManualLayout from '../components/manual/ManualLayout'
import ManualSection from '../components/manual/ManualSection'
import type { RouteDescriptor } from '../routes/registry'

/**
 * `beer-game-manual.md` Part 2, as UI copy.
 *
 * Amended for **D6**: v1 is untimed. The manual's original text promised a
 * per-decision countdown and an automatic order when it expired, and neither
 * exists. Copy that describes behaviour the build does not have is worse than
 * no copy, because a player plans around it.
 *
 * Public and backend-independent: a host sends this link before anybody has
 * signed in or the server has woken up.
 */
export function PlayerManualPage(): ReactElement {
  return (
    <ManualLayout
      title="Player manual"
      audience="For the four people who play. You do not need the host's manual."
      otherManual={{ to: '/host-manual', label: 'Host manual' }}
    >
      <ManualSection heading="What you're doing">
        <p>
          You run one link in a beer supply chain. Every week you receive beer from your
          supplier, ship beer to your customer, and decide how much to order for the future.
        </p>
        <p>
          You have one job: <strong>keep costs down.</strong> You pay for every case sitting in
          your warehouse, and you pay more for every case you owe and can't deliver. Too much
          stock is expensive. Too little is worse.
        </p>
      </ManualSection>

      <ManualSection heading="The chain">
        <pre className="overflow-x-auto rounded-md border border-border bg-surface-sunken px-4 py-3 text-sm">
          Customer → Retailer → Wholesaler → Distributor → Factory
        </pre>
        <p>Orders travel up the chain. Beer travels back down.</p>
        <p>You'll be given one of these four roles:</p>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          <li>
            <strong>Retailer</strong> — you sell to the public, and you're the only one who sees
            what real customers actually want.
          </li>
          <li>
            <strong>Wholesaler</strong> — you supply the Retailer and order from the Distributor.
          </li>
          <li>
            <strong>Distributor</strong> — you supply the Wholesaler and order from the Factory.
          </li>
          <li>
            <strong>Factory</strong> — you brew. You don't order from anyone; you start
            production, and it takes time to finish.
          </li>
        </ul>
        <p>You only deal with your immediate neighbours. You cannot see past them.</p>
      </ManualSection>

      <ManualSection heading="The one thing that makes this hard">
        <p>
          <strong>Nothing happens immediately.</strong> When you place an order, it takes a
          couple of weeks just to reach your supplier, and a couple more for the beer to arrive.
          So an order you place today shows up in your warehouse roughly four weeks from now.
        </p>
        <p>
          This means you are always ordering for a situation you can't see yet — and it means
          the effect of a decision you've already made hasn't shown up yet either.
        </p>
      </ManualSection>

      <ManualSection heading="Joining">
        <p>
          Open the link your host sent you. Enter a display name. Sign in if you want your
          results tracked across games, or continue as a guest if you don't.
        </p>
        <p>
          Then wait. The host is configuring the game. You'll see who else has joined. You'll
          find out your role either in the lobby or when the game starts, depending on how your
          host set it up.
        </p>
      </ManualSection>

      <ManualSection heading="Your screen">
        <ul className="flex list-disc flex-col gap-2 pl-6">
          <li>
            <strong>On hand</strong> — beer in your warehouse right now.
          </li>
          <li>
            <strong>Backlog</strong> — beer you owe your customer and haven't delivered. This
            carries over week to week and costs you more than storage does. It doesn't
            disappear; you still have to ship it.
          </li>
          <li>
            <strong>Incoming shipments</strong> — beer already on its way to you, week by week.{' '}
            <em>Pay close attention to this.</em> It's the number most people ignore, and
            ignoring it is how you lose.
          </li>
          <li>
            <strong>Orders in flight</strong> — orders you've already placed that haven't reached
            your supplier yet.
          </li>
          <li>
            <strong>Incoming order</strong> — how much your customer wants from you this week.
          </li>
          <li>
            <strong>Your costs</strong> — this week's, and your running total.
          </li>
        </ul>
      </ManualSection>

      <ManualSection heading="Each week">
        <p>
          <strong>1. See what happened.</strong> The week settles automatically. You get a
          plain-language recap: what arrived, what your customer asked for, how much you
          shipped, what you couldn't ship, and what it cost you. Read it. It's the only feedback
          you get.
        </p>
        <p>
          <strong>2. Decide.</strong> Enter one number: how much to order from your supplier. The
          screen tells you when it will arrive. Shortcuts are available — match the order you
          just received, repeat your last order, or order nothing.
        </p>
        <p>
          <strong>3. Confirm and wait.</strong> Once you submit, you'll see who else still has to
          decide. Everyone's order is hidden until the week closes. There is no time limit — the
          week closes when everyone has decided, or when the host closes it.
        </p>
        <p>Then the next week begins.</p>
      </ManualSection>

      <ManualSection heading="The rules">
        <ul className="flex list-disc flex-col gap-2 pl-6">
          <li>
            <strong>No talking about numbers.</strong> You may not tell anyone what you ordered,
            what your inventory is, or what you're planning. No chat, no gestures, no showing
            your screen. This is the point of the exercise, not a formality.
          </li>
          <li>
            <strong>You cannot un-order.</strong> Once an order is placed, it's coming.
          </li>
          <li>
            <strong>Backlog doesn't go away.</strong> You ship it eventually, and you pay for it
            every week until you do.
          </li>
          <li>
            <strong>You cannot ship what you don't have.</strong> If a customer wants 12 and you
            have 5, you ship 5 and owe 7.
          </li>
        </ul>
      </ManualSection>

      <ManualSection heading="Advice, honestly given">
        <p>Order something close to what your customer is asking for, and adjust gently.</p>
        <ManualCallout title="Before you increase an order, look at what's already on the way.">
          The most common mistake in this game — by a wide margin — is to see low inventory,
          order more, see inventory still low next week because nothing has arrived yet, and
          order more again. You end up with four weeks of panic orders landing at once, a
          warehouse you can't afford, and then you slam the brakes and order nothing, which
          starves everyone upstream of you.
        </ManualCallout>
        <p>Resist the swing. Small, steady corrections beat big ones almost every time.</p>
        <p>
          And when it goes wrong anyway — and for most groups it does — that isn't a personal
          failure. It's the result the game is built to produce. That's what you'll talk about
          afterwards.
        </p>
      </ManualSection>

      <ManualSection heading="At the end">
        <p>
          You'll see your final costs, everyone else's, and a chart comparing what customers
          actually wanted against what each of you ordered.
        </p>
        <p>
          For most groups, customer demand is close to a flat line and the four order curves look
          like an earthquake. Stick around for the debrief — the explanation for that gap is the
          whole reason you played.
        </p>
      </ManualSection>
    </ManualLayout>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const route: RouteDescriptor = {
  path: '/player-manual',
  guard: 'public',
  element: <PlayerManualPage />,
}

export default PlayerManualPage
