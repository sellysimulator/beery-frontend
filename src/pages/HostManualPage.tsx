import type { ReactElement } from 'react'
import ManualBook, { type ManualPageSpec } from '../components/manual/ManualBook'
import { contentsPage } from '../components/manual/manualContents'
import ManualCallout from '../components/manual/ManualCallout'
import ManualLayout from '../components/manual/ManualLayout'
import type { RouteDescriptor } from '../routes/registry'

/**
 * `beer-game-manual.md` Part 1, as UI copy.
 *
 * Amended in three places against the frozen decisions:
 *   - **D6**: v1 is untimed, so the per-decision countdown, the timeout rule
 *     and the control that extended the countdown are all gone.
 *   - **D3**: hosting needs no account, so Step 1 no longer asks for one.
 *   - **D14**: `clone_room` is phase 2, so Step 5 says to create a new room.
 *
 * Presented as a page-turning book (`ManualBook`, the same `react-pageflip`
 * treatment Selly's two manuals use), so the steps below are leaves. Step 3
 * and the debrief run long and are split across consecutive leaves; a
 * continuation is marked so the contents page lists the step once.
 */
const BODY: ManualPageSpec[] = [
  {
    id: 'what-the-host-does',
    heading: 'What the host does',
    content: (
      <>
        <p>
          You create the game, choose the rules, hand out the roles, and run the session.{' '}
          <strong>You do not play.</strong> You hold no inventory and pay no costs. Your job is
          to set the scenario, keep the session moving, and lead the debrief at the end.
        </p>
        <p>
          You see everything: all four players' inventory, backlog, orders and costs, and the
          true customer demand — including the things the players can't see.
        </p>
      </>
    ),
  },
  {
    id: 'before-you-start',
    heading: 'Before you start',
    content: (
      <p>
        You need four players (or fewer, with bots filling the gaps), a way to send them a link,
        and a rough idea of what you want them to learn. Thirty-six weeks of play runs a little
        over half an hour, plus debrief.
      </p>
    ),
  },
  {
    id: 'step-1',
    heading: 'Step 1 — Create the room',
    content: (
      <>
        <p>
          Create a game — you can sign in first to keep your results, or just start one. You'll
          get a <strong>room code</strong> and an <strong>invite link</strong>. Send the link to
          your players however you like — chat, email, or on screen for them to type in.
        </p>
        <p>Only you can see the room until you start.</p>
      </>
    ),
  },
  {
    id: 'step-2',
    heading: 'Step 2 — Let players in',
    content: (
      <>
        <p>
          Players open the link, enter a name, and land in the lobby. You'll see them appear in
          your participant list.
        </p>
        <p>
          They can't see your settings while they wait. They just see who else has joined and a
          message telling them you're still setting up. Take the time you need.
        </p>
      </>
    ),
  },
  {
    id: 'step-3',
    heading: 'Step 3 — Configure the game',
    content: (
      <>
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
      </>
    ),
  },
  {
    id: 'step-3-settings',
    heading: 'Step 3 — Configure the game, continued',
    content: (
      <>
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
      </>
    ),
  },
  {
    id: 'step-3-costs',
    heading: 'Step 3 — Configure the game, continued',
    content: (
      <>
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
      </>
    ),
  },
  {
    id: 'step-3-visibility',
    heading: 'Step 3 — Configure the game, continued',
    content: (
      <>
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
      </>
    ),
  },
  {
    id: 'step-4',
    heading: 'Step 4 — Assign roles',
    content: (
      <>
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
      </>
    ),
  },
  {
    id: 'step-5',
    heading: 'Step 5 — Start',
    content: (
      <p>
        Once all four roles are filled and your settings are valid, start the game. Settings lock
        at this point — they can't be changed mid-game. If you need different parameters, end the
        game and create a new room.
      </p>
    ),
  },
  {
    id: 'step-6',
    heading: 'Step 6 — Run the session',
    content: (
      <>
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
      </>
    ),
  },
  {
    id: 'step-6-rules',
    heading: 'Step 6 — Run the session, continued',
    content: (
      <>
        <p>Use presentation mode if you're projecting for a room.</p>
        <ManualCallout title="Two rules worth enforcing out loud">
          Players must not talk to each other about quantities, and nobody may show anyone else
          their screen. The silence is not an arbitrary restriction — it's the thing being
          simulated.
        </ManualCallout>
      </>
    ),
  },
  {
    id: 'step-7',
    heading: 'Step 7 — Debrief',
    content: (
      <>
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
        </ol>
      </>
    ),
  },
  {
    id: 'step-7-findings',
    heading: 'Step 7 — Debrief, continued',
    content: (
      <ol start={3} className="flex list-decimal flex-col gap-2 pl-6">
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
          Point out that no one was incompetent and no one was acting in bad faith. The structure
          produced the outcome.
        </li>
      </ol>
    ),
  },
  {
    id: 'step-7-export',
    heading: 'Step 7 — Debrief, continued',
    content: <p>You can export the full week-by-week data as CSV or JSON for further analysis.</p>,
  },
]

const PAGES: ManualPageSpec[] = [
  {
    id: 'cover',
    variant: 'cover',
    content: (
      <>
        <p className="text-5xl" aria-hidden="true">
          🎛️
        </p>
        <p className="text-3xl font-bold">Host manual</p>
        <p className="text-ink-muted">
          Set the scenario, keep the room moving, and run the debrief that does the teaching.
        </p>
      </>
    ),
  },
  contentsPage(BODY),
  ...BODY,
  {
    id: 'back-cover',
    variant: 'back',
    content: (
      <>
        <p className="text-4xl" aria-hidden="true">
          📈
        </p>
        <p className="text-2xl font-bold">The chart is the lesson.</p>
        <p className="text-ink-muted">
          Nobody was incompetent. The structure produced the outcome — that is the debrief.
        </p>
      </>
    ),
  },
]

export function HostManualPage(): ReactElement {
  return (
    <ManualLayout
      title="Host manual"
      audience="For the person who sets up and runs the session. You do not play."
      otherManual={{ to: '/player-manual', label: 'Player manual' }}
    >
      <ManualBook title="Host manual" pages={PAGES} />
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
