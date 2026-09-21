# The Beer Game — Instructions Manual

This manual has two parts. **Part 1 is for the host** — the person who sets up and runs the session. **Part 2 is for players** — the four people who actually play. Read your part; you don't need the other one.

---

# Part 1 — Host Manual

## What the host does

You create the game, choose the rules, hand out the roles, and run the session. **You do not play.** You hold no inventory and pay no costs. Your job is to set the scenario, keep the session moving, and lead the debrief at the end.

You see everything: all four players' inventory, backlog, orders and costs, and the true customer demand — including the things the players can't see.

## Before you start

You need four players (or fewer, with bots filling the gaps), a way to send them a link, and a rough idea of what you want them to learn. Thirty-six weeks of play with a 60-second timer runs a little over half an hour, plus debrief.

## Step 1 — Create the room

Sign in and create a game. You'll get a **room code** and an **invite link**. Send the link to your players however you like — chat, email, or on screen for them to type in.

Only you can see the room until you start.

## Step 2 — Let players in

Players open the link, enter a name, and land in the lobby. You'll see them appear in your participant list.

They can't see your settings while they wait. They just see who else has joined and a message telling them you're still setting up. Take the time you need.

## Step 3 — Configure the game

This is the part that matters. Presets get you running fast:

- **Classic MIT** — 36 weeks, 12 units starting inventory, 2-week delays, demand of 4 stepping to 8 at week 5, $0.50 holding and $1.00 backlog. This is the standard scenario and the one that produces the textbook result.
- **Fast Game** — around 20 weeks with a shorter timer, for a tight schedule.
- **Chaos** — long delays, random demand. Expect spectacular failure, which is the point.

Or set everything yourself:

**Length and pacing.** Number of weeks. Seconds per decision, or untimed. What happens if someone runs out of time — repeat their last order, order zero, or match the demand they just received.

**Starting conditions**, per role or all at once. Opening inventory. Opening backlog. How many weeks shipments spend in transit. How many weeks orders take to reach the supplier. How much is already in the pipeline at week one. For the Factory, the production delay and any capacity limit.

**Costs.** Holding cost per unit per week. Backlog cost per unit per week. Backlog should cost more than holding — that asymmetry is what makes the game a real decision. You can set different costs per role if you want to model an expensive-to-store product at one stage.

**Customer demand.** Constant, a one-time step, a gradual ramp, seasonal, random, or a custom sequence you paste in. The step is the classic and the clearest teaching tool. Only the Retailer sees it — unless you decide otherwise below.

**Visibility.** These are your teaching levers:
- *Show true customer demand to everyone* — turn this on to run the same scenario a second time and show how much information sharing is worth.
- *Show all inventories* — full transparency across the chain.
- *Highlight the supply line* — keep this on for beginners. It reminds players what they've already ordered but not yet received. Turn it off to make the game considerably harder.
- *Show a live leaderboard* — competitive, but it can distort behaviour.

**Tip:** run the classic settings first, debrief, then re-run with demand shared. The contrast does more teaching than any explanation.

## Step 4 — Assign roles

Three options:

- **You assign** — drag each player onto Retailer, Wholesaler, Distributor or Factory. Use this when you want a specific person in a specific seat.
- **Players choose** — first come, first served from the lobby. You can override anyone before starting.
- **Random** — roles are dealt when the game starts. Fastest, and avoids anyone cherry-picking the easy seat.

If you have fewer than four people, enable **bot fill**. Empty roles are played by an automated agent and are clearly marked so everyone knows which links in the chain are human.

## Step 5 — Start

Once all four roles are filled and your settings are valid, start the game. Settings lock at this point — they can't be changed mid-game. If you need different parameters, end the game and clone the room.

## Step 6 — Run the session

Your console shows all four players side by side, live, with their submission status each week.

You can:
- **Pause** and **resume** — for questions, technical trouble, or a teaching moment.
- **Extend the timer** for the current week if someone needs a moment.
- **Force-close** a decision window if someone has walked away.
- **Swap in a bot** for a player who has dropped out.
- **End early** if you're running out of time — you still get full results for the weeks played.

Use **presentation mode** if you're projecting for a room.

**Two rules worth enforcing out loud:** players must not talk to each other about quantities, and nobody may show anyone else their screen. The silence is not an arbitrary restriction — it's the thing being simulated.

## Step 7 — Debrief

The results screen is the lesson. Show it on the shared screen and walk through it:

1. **Total cost per role and for the chain.** Ask who they think did worst, before revealing it.
2. **The big chart** — true customer demand plotted against all four order streams. Customer demand barely moves. The Retailer's orders swing. The Wholesaler's swing more. The Factory's are wild. That's the bullwhip effect, and they produced it themselves.
3. **The bullwhip ratio** per role — how much each stage amplified the variation.
4. Ask each player what they were thinking when they placed their largest order. Almost always, the answer is some version of *"I'd ordered more but nothing was arriving, so I ordered again."* That's supply-line underweighting, and it's the real finding.
5. Point out that no one was incompetent and no one was acting in bad faith. The structure produced the outcome.

You can export the full week-by-week data as CSV or JSON for further analysis.

---

# Part 2 — Player Manual

## What you're doing

You run one link in a beer supply chain. Every week you receive beer from your supplier, ship beer to your customer, and decide how much to order for the future.

You have one job: **keep costs down.** You pay for every case sitting in your warehouse, and you pay more for every case you owe and can't deliver. Too much stock is expensive. Too little is worse.

## The chain

```
Customer → Retailer → Wholesaler → Distributor → Factory
```

Orders travel up the chain. Beer travels back down.

You'll be given one of these four roles:

- **Retailer** — you sell to the public, and you're the only one who sees what real customers actually want.
- **Wholesaler** — you supply the Retailer and order from the Distributor.
- **Distributor** — you supply the Wholesaler and order from the Factory.
- **Factory** — you brew. You don't order from anyone; you start production, and it takes time to finish.

You only deal with your immediate neighbours. You cannot see past them.

## The one thing that makes this hard

**Nothing happens immediately.** When you place an order, it takes a couple of weeks just to reach your supplier, and a couple more for the beer to arrive. So an order you place today shows up in your warehouse roughly four weeks from now.

This means you are always ordering for a situation you can't see yet — and it means the effect of a decision you've already made hasn't shown up yet either.

## Joining

Open the link your host sent you. Enter a display name. Sign in if you want your results tracked across games, or continue as a guest if you don't.

Then wait. The host is configuring the game. You'll see who else has joined. You'll find out your role either in the lobby or when the game starts, depending on how your host set it up.

## Your screen

**On hand** — beer in your warehouse right now.

**Backlog** — beer you owe your customer and haven't delivered. This carries over week to week and costs you more than storage does. It doesn't disappear; you still have to ship it.

**Incoming shipments** — beer already on its way to you, week by week. *Pay close attention to this.* It's the number most people ignore, and ignoring it is how you lose.

**Orders in flight** — orders you've already placed that haven't reached your supplier yet.

**Incoming order** — how much your customer wants from you this week.

**Your costs** — this week's, and your running total.

## Each week

**1. See what happened.** The week settles automatically. You get a plain-language recap: what arrived, what your customer asked for, how much you shipped, what you couldn't ship, and what it cost you. Read it. It's the only feedback you get.

**2. Decide.** Enter one number: how much to order from your supplier. The screen tells you when it will arrive.

Shortcuts are available — match the order you just received, repeat your last order, or order nothing.

**3. Confirm and wait.** Once you submit, you'll see who else still has to decide. Everyone's order is hidden until the week closes. If there's a timer and it runs out, the system places an order for you according to your host's rule — so decide before then.

Then the next week begins.

## The rules

- **No talking about numbers.** You may not tell anyone what you ordered, what your inventory is, or what you're planning. No chat, no gestures, no showing your screen. This is the point of the exercise, not a formality.
- **You cannot un-order.** Once an order is placed, it's coming.
- **Backlog doesn't go away.** You ship it eventually, and you pay for it every week until you do.
- **You cannot ship what you don't have.** If a customer wants 12 and you have 5, you ship 5 and owe 7.

## Advice, honestly given

Order something close to what your customer is asking for, and adjust gently.

**Before you increase an order, look at what's already on the way.** The most common mistake in this game — by a wide margin — is to see low inventory, order more, see inventory still low next week because nothing has arrived yet, and order more again. You end up with four weeks of panic orders landing at once, a warehouse you can't afford, and then you slam the brakes and order nothing, which starves everyone upstream of you.

Resist the swing. Small, steady corrections beat big ones almost every time.

And when it goes wrong anyway — and for most groups it does — that isn't a personal failure. It's the result the game is built to produce. That's what you'll talk about afterwards.

## At the end

You'll see your final costs, everyone else's, and a chart comparing what customers actually wanted against what each of you ordered.

For most groups, customer demand is close to a flat line and the four order curves look like an earthquake. Stick around for the debrief — the explanation for that gap is the whole reason you played.
