# FAQ

## Does AbstractFlow Need Python?

No. AbstractFlow is the web editor package `@abstractframework/flow`.

Python services are used by other framework packages such as AbstractGateway, AbstractRuntime, AbstractCore, and capability plugins. Flow itself does not ship a Python package or local execution host.

## Why Do I Need A Gateway Token?

Flow is only the editor. Gateway owns user authentication and runtime isolation. Each browser must sign in with a Gateway user token so Gateway can route requests to the right user/runtime.

## Can Flow Store Provider API Keys?

No. Configure provider credentials, OpenAI-compatible endpoint profiles, and model defaults in the Gateway console. Flow discovers those providers and models from Gateway.

## Where Are Workflows Stored?

Gateway stores VisualFlow drafts, published workflow bundles, run ledgers, and artifacts. Flow may import/export JSON in the browser, but persistent state belongs to Gateway.

## How Do I Use A Custom OpenAI-Compatible Endpoint?

Create a provider endpoint profile in Gateway with its base URL, API key, description, and discovered models. It will surface in Flow as a virtual provider.

## What Happens If Gateway Is Down?

The editor can load its static UI, but discovery, save, publish, run, artifact, and history features require Gateway.

## Is There A Python `abstractflow` Package?

No. AbstractFlow is the web editor only. The responsibilities of a workflow
backend belong to these packages:

- visual execution and bundle semantics: AbstractRuntime
- users, auth, runtime routing, workflow registry, runs, artifacts: AbstractGateway
- provider calls and capability plugins: AbstractCore
- visual authoring UI: `@abstractframework/flow`

## What Does Declaring An Interface Do?

An interface such as `abstractcode.agent.v1` tells whoever runs workflows
that this one can be started that way, and which pins it takes and gives. Declaring one in the Flow Library adds the pins it
requires to `On Flow Start` and `On Flow End`; you then wire them. See
[VisualFlow JSON > Interfaces](visualflow.md#interfaces) for every interface
and its pins.

## What Is The Difference Between A Runnable Flow And A Triggered Flow?

What starts it. A runnable (chat) flow declares an interface and runs when a
person or an app asks; a triggered flow runs by itself when mail, a feed item
or a webhook call arrives, with typed `On Flow Start` pins for it, or when
someone presses Run now. There is no separate automation kind: an automation
is a published flow plus what starts it. The Flow Library groups flows this
way (Chat, Triggered, Other). There is no scheduled kind: schedules are not
set in Flow (next question). See [Web editor > Kinds of
flows](web-editor.md#kinds-of-flows).

## How Do I Run A Workflow Every Few Minutes, Or Every Morning?

Give its automation a schedule in Observer or the Assistant (or with
`POST /api/gateway/automations`). A schedule is a property of the automation,
not of the workflow: Flow designs and tests workflows and never sets one. In
the editor, design the workflow, pick what else starts it if anything (mail, a
feed, a webhook, or by hand) and press **Turn it on** in the Automation dialog;
then set the schedule in Observer or the Assistant. A flow saved earlier with a
schedule keeps it and shows it in words. The **Wait Until**, **Wait for
Event** and **Delay** nodes pause a run that has already started and do not
start runs (see [Web editor > Waits inside a
flow](web-editor.md#waits-inside-a-flow)). See [Web editor >
Automations](web-editor.md#automations).

## How Does A Workflow Read The Event That Started It?

From `On Flow Start`: a workflow created with a trigger (or saved with one in
the Automation dialog) has typed outputs for what arrived: `messages` and
`mailbox` for mail, `items` and `feed` for a feed, `calls` for a webhook,
`scheduled_at` and `occurrence` for a schedule (set in Observer or the
Assistant), plus `event` (the whole raw
event). Put what the person should see on `On Flow End`'s `response`, and
`notify` for an alert. See [Web editor > What arrives, what the person
sees](web-editor.md#what-arrives-what-the-person-sees).

## Where Do I Create A Feed Or Webhook Connection?

On the Gateway console's **Triggers** page (`/console#triggers`). Under
**When something arrives** (New Flow or the Automation dialog), **Set up a new
one…** opens that page; press **Refresh** when you come back. Mailboxes are not
connections: **Add a mailbox…** opens the console's account page, where you
connect one; it then appears by its address ("When mail arrives in
me@example.org").

## Why Does The Automation Dialog Say Trigger Sources Are Unavailable?

The connected Gateway does not serve automations (it reports them as
unavailable or does not serve `/api/gateway/trigger-sources`). Connect to a
Gateway with automations enabled, then press **Try again**.

## Why Does My ForEach Run Only Once?

Its body (the steps wired to `loop`) reaches On Flow End, and On Flow End ends the run wherever it is reached. Wire the loop's `done` to On Flow End instead; the body's last node needs no wire out. The run checks say so and offer **Fix the loop**, which does exactly that. See [Web editor > A loop whose body ends the run](web-editor.md#a-loop-whose-body-ends-the-run).

## Why Does A Node Show "N hidden"?

The stored workflow wires pins the canvas cannot draw, such as a code node's
returned keys. Those connections run and are saved as stored. See
[Web editor > Hidden Connections](web-editor.md#hidden-connections).

## Where Do I Find The AbstractFlow And Gateway Versions?

Open the About dialog (the `i` button in the top bar). See
[Web editor > About](web-editor.md#about).

## Can I Edit Workflows On A Phone Or Tablet?

Yes. Below 1024 px the canvas fills the screen and the palette and panels
open as drawers. On a touch screen, tap a palette node to add it to the
centre of the canvas, and pinch to zoom in on node cards. See
[Web editor > Responsive Layout](web-editor.md#responsive-layout).

## Something Does Not Work

See [Troubleshooting](troubleshooting.md) for symptoms, causes, and fixes.
