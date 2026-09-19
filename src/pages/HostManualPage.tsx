import type { ReactElement } from 'react'
import ManualCallout from '../components/manual/ManualCallout'
import ManualLayout from '../components/manual/ManualLayout'
import ManualSection from '../components/manual/ManualSection'
import type { RouteDescriptor } from '../routes/registry'

/**
 * `beer-game-manual.md` Part 1, as UI copy.
 *
 * Amended in three places against the frozen decisions:
 *   - **D6**: v1 is untimed, so the per-decision countdown, the timeout rule
 *     and the control that extended the countdown are all gone.
 *   - **D3**: hosting needs no account, so Step 1 no longer asks for one.
 *   - **D14**: `clone_room` is phase 2, so Step 5 says to create a new room.
 */
export function HostManualPage(): ReactElement {
  return (
    <ManualLayout
      title="Host manual"
      audience="For the person who sets up and runs the session. You do not play."
      otherManual={{ to: '/player-manual', label: 'Player manual' }}
    >
      <ManualSection heading="What the host does">
        <p>
          You create the game, choose the rules, hand out the roles, and run the session.{' '}
          <strong>You do not play.</strong> You hold no inventory and pay no costs. Your job is
          to set the scenario, keep the session moving, and lead the debrief at the end.
        </p>
        <p>
          You see everything: all four players' inventory, backlog, orders and costs, and the
          true customer demand — including the things the players can't see.
        </p>
      </ManualSection>

      <ManualSection heading="Before you start">
        <p>
          You need four players (or fewer, with bots filling the gaps), a way to send them a
          link, and a rough idea of what you want them to learn. Thirty-six weeks of play runs a
          little over half an hour, plus debrief.
        </p>
      </ManualSection>

      <ManualSection heading="Step 1 — Create the room">
        <p>
          Create a game — you can sign in first to keep your results, or just start one.
          You'll get a <strong>room code</strong> and an{' '}
          <strong>invite link</strong>. Send the link to your players however you like — chat,
          email, or on screen for them to type in.
        </p>
        <p>Only you can see the room until you start.</p>
      </ManualSection>

      <ManualSection heading="Step 2 — Let players in">
        <p>
          Players open the link, enter a name, and land in the lobby. You'll see them appear in
          your participant list.
        </p>
        <p>
          They can't see your settings while they wait. They just see who else has joined and a
          message telling them you're still setting up. Take the time you need.
        </p>
      </ManualSection>

      <ManualSection heading="Step 3 — Configure the game">
        <p>This is the part that matters. Presets get you running fast:</p>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          <li>
            <strong>Classic MIT</strong> — 36 weeks, 12 units starting inventory, 2-week delays,
            demand of 4 stepping to 8 at week 5, $0.50 holding and $1.00 backlog. This is the
            standard scenario and the one that produces the textbook result.
          </li>
          <li>
            <strong>Fast Game</strong> — around 20 weeks, for a tight schedule.
          </li>
          <li>
            <strong>Chaos</strong> — long delays, random demand. Expect spectacular failure,
            which is the point.
          </li>
        </ul>

        <p>Or set everything yourself:</p>
        <p>
          <strong>Length.</strong> Number of weeks. There is no time limit — the week closes when
          everyone has decided, or when the host closes it.
        </p>
        <p>
          <strong>Starting conditions</strong>, per role or all at once. Opening inventory.
          Opening backlog. How many weeks shipments spend in transit. How many weeks orders take
          to reach the supplier. How much is already in the pipeline at week one. For the
          Factory, the production delay and any capacity limit.
        </p>
        <p>
          <strong>Costs.</strong> Holding cost per unit per week. Backlog cost per unit per week.
          Backlog should cost more than holding — that asymmetry is what makes the game a real
          decision. You can set different costs per role if you want to model an
          expensive-to-store product at one stage.
        </p>
        <p>
          <strong>Customer demand.</strong> Constant, a one-time step, a gradual ramp, seasonal,
          random, or a custom sequence you paste in. The step is the classic and the clearest
          teaching tool. Only the Retailer sees it — unless you decide otherwise below.
        </p>
        <p>
          <strong>Visibility.</strong> These are your teaching levers:
        </p>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          <li>
            <em>Show true customer demand to everyone</em> — turn this on to run the same
            scenario a second time and show how much information sharing is worth.
          </li>
          <li>
            <em>Show all inventories</em> — full transparency across the chain.
          </li>
          <li>
            <em>Highlight the supply line</em> — keep this on for beginners. It reminds players
            what they've already ordered but not yet received. Turn it off to make the game
            considerably harder.
          </li>
          <li>
            <em>Show a live leaderboard</em> — competitive, but it can distort behaviour.
          </li>
        </ul>

        <ManualCallout title="Tip">
          Run the classic settings first, debrief, then re-run with demand shared. The contrast
          does more teaching than any explanation.
        </ManualCallout>
      </ManualSection>

      <ManualSection heading="Step 4 — Assign roles">
        <p>Three options:</p>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          <li>
            <strong>You assign</strong> — put each player into Retailer, Wholesaler, Distributor
            or Factory. Use this when you want a specific person in a specific seat.
          </li>
          <li>
            <strong>Players choose</strong> — first come, first served from the lobby. You can
            override anyone before starting.
          </li>
          <li>
            <strong>Random</strong> — roles are dealt when the game starts. Fastest, and avoids
            anyone cherry-picking the easy seat.
          </li>
        </ul>
        <p>
          If you have fewer than four people, enable <strong>bot fill</strong>. Empty roles are
          played by an automated agent and are clearly marked so everyone knows which links in
          the chain are human.
        </p>
      </ManualSection>

      <ManualSection heading="Step 5 — Start">
        <p>
          Once all four roles are filled and your settings are valid, start the game. Settings
          lock at this point — they can't be changed mid-game. If you need different parameters,
          end the game and create a new room.
        </p>
      </ManualSection>

      <ManualSection heading="Step 6 — Run the session">
        <p>
          Your console shows all four players side by side, live, with their submission status
          each week.
        </p>
        <p>You can:</p>
        <ul className="flex list-disc flex-col gap-2 pl-6">
          <li>
            <strong>Pause</strong> and <strong>resume</strong> — for questions, technical
            trouble, or a teaching moment.
          </li>
          <li>
            <strong>Close a week</strong> yourself if someone has walked away and the rest of the
            room is waiting on them.
          </li>
          <li>
            <strong>Swap in a bot</strong> for a player who has dropped out.
          </li>
          <li>
            <strong>End early</strong> if the session is running short — you still get full
            results for the weeks played.
          </li>
        </ul>
        <p>Use presentation mode if you're projecting for a room.</p>
        <ManualCallout title="Two rules worth enforcing out loud">
          Players must not talk to each other about quantities, and nobody may show anyone else
          their screen. The silence is not an arbitrary restriction — it's the thing being
          simulated.
        </ManualCallout>
      </ManualSection>

      <ManualSection heading="Step 7 — Debrief">
        <p>
          The results screen is the lesson. Show it on the shared screen and walk through it:
        </p>
        <ol className="flex list-decimal flex-col gap-2 pl-6">
          <li>
            <strong>Total cost per role and for the chain.</strong> Ask who they think did worst,
            before revealing it.
          </li>
          <li>
            <strong>The big chart</strong> — true customer demand plotted against all four order
            streams. Customer demand barely moves. The Retailer's orders swing. The Wholesaler's
            swing more. The Factory's are wild. That's the bullwhip effect, and they produced it
            themselves.
          </li>
          <li>
            <strong>The bullwhip ratio</strong> per role — how much each stage amplified the
            variation.
          </li>
          <li>
            Ask each player what they were thinking when they placed their largest order. Almost
            always, the answer is some version of{' '}
            <em>"I'd ordered more but nothing was arriving, so I ordered again."</em> That's
            supply-line underweighting, and it's the real finding.
          </li>
          <li>
            Point out that no one was incompetent and no one was acting in bad faith. The
            structure produced the outcome.
          </li>
        </ol>
        <p>You can export the full week-by-week data as CSV or JSON for further analysis.</p>
      </ManualSection>
    </ManualLayout>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const route: RouteDescriptor = {
  path: '/host-manual',
  guard: 'public',
  element: <HostManualPage />,
}

export default HostManualPage
