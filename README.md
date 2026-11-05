# Top Spinner Cricket recreation

This is an original, editable browser recreation inspired by the screenshots of Bennett Foddy's Flash game. It does not contain the original ActionScript or artwork. The player, bat, wicket, ball, and field are drawn by JavaScript on a canvas.

## Run and edit

1. Extract this ZIP so `index.html`, `styles.css`, and `game.js` stay together.
2. Open `index.html` in a desktop browser.
3. Open `game.js` in a text editor. Change the `TUNING` or `TARGET_TIERS` block near the top, save, and refresh the browser. There is no build step.

The separate `top-spinner-recreation.html` is a one-file copy. You can edit its `TUNING` or `TARGET_TIERS` block inside the `<script>` near the end of the file, save, and refresh. Changes to the ZIP version and the one-file copy do **not** automatically sync with one another.

Choose a difficulty from the menu above the field. The default **Any target** mode draws an integer from 1 to 1000; the other modes use smaller ranges. A new target is picked when each innings begins. Reach or pass it to win; if the ball or bat hits the wicket first, the innings ends. The HUD shows the target, its tier, and runs still needed. Changing the menu during play affects the **next** innings. Move the mouse to position the **tip** of the bat. Sweep to hit a ball. Move left to swing behind the batter, but a deep swing can hit your own wicket. **P** pauses, **R** restarts. On touchscreens, drag across the field.

## Change the sizes and spacing yourself

At the top of `game.js` you will find:

```js
const TUNING={
  shoulderX:284, shoulderY:208, hipX:260, hipY:281,
  headOffsetX:5, headOffsetY:-29,
  backFootX:132, frontFootX:330,
  batLength:92, armReach:74, bladeHalfWidth:5,
  restTipX:286, restTipY:345, batGroundClearance:8,
  wicketX:70, stumpTop:220, stumpBottom:353, stumpGap:6
};
```

These are coordinates on an **800 × 520** field, even if the game appears larger on your screen. `x` increases rightward; `y` increases downward. Grass is at `y = 355`. Change just one or two values at a time and refresh.

| If you want to… | Edit | Start with |
| --- | --- | --- |
| Move the whole upper batter left/right | `shoulderX` | Change by 5–10; move `hipX` similarly if the torso looks too tilted. |
| Move the hips and stance | `hipX`, `hipY`, `backFootX`, `frontFootX` | Feet at `132` and `330` give the wide lunge. Feet affect drawing, not collisions. |
| Change head placement | `headOffsetX`, `headOffsetY` | A more negative `headOffsetY` raises the helmet. |
| Change space behind the batter | `wicketX` | `70` matches the reference's approximate horizontal spacing; `65–80` keeps a deliberate backswing near the wicket. Smaller numbers move it farther back. |
| Change wicket height and breadth | `stumpTop`, `stumpBottom`, `stumpGap` | Smaller `stumpTop` makes it taller; keep `stumpBottom` around `353`. Drawn stumps and contact checks share these values. |
| Make the bat longer or shorter | `batLength` | Try `88–98`. This changes both the drawing and reach/collision segment. |
| Make the bat thinner or wider | `bladeHalfWidth` | `5` means a 10-pixel-wide blade. Try `4–6`; collision thickness follows it. |
| Allow more or less arm reach | `armReach` | Try `69–79`; too little reach can make hitting your wicket impossible. |
| Put the starting bat nearer the ground | `restTipY`, `batGroundClearance` | The tip is `345`; it cannot drop below `355 - batGroundClearance`. |
| Shift the resting bat left/right | `restTipX` | Try `276–300`. |

The important gap is **`shoulderX - wicketX`**, currently `284 - 70 = 214` pixels. The visible bat is positioned from the moving shoulder through the hand to the tip, while wicket contact tests use that exact hand-to-tip segment and the three drawn stump positions. If you greatly increase the gap, a hit wicket becomes harder or impossible unless you also increase reach or backswing lean.

## Random run targets and difficulty

The `TARGET_TIERS` table is directly below `TUNING` in `game.js`. Each row defines a range of **whole-number run targets**, inclusive at both ends:

| Difficulty | Run target |
| --- | ---: |
| Easy | 1–50 |
| Medium | 51–200 |
| Hard | 201–500 |
| Expert | 501–1000 |
| Any target (default) | 1–1000 |

To tune the ranges, edit the `min` and `max` values in `TARGET_TIERS`. The **Any target** range automatically stretches from the first tier's minimum to the last tier's maximum. Keep tier ranges contiguous if you want every target to have a named difficulty. For example, change `max:50` in Easy and `min:51` in Medium together.

`randomTarget(min,max,previous)` uses `Math.random()` to choose a uniformly random integer from the selected inclusive range. It excludes the previous target when possible, so consecutive innings get different goals. `reset` reads the menu and picks a target; `award` calls `win` when `runs >= target`. Since shots score 2, 4, or 6, an odd target can be surpassed; that still wins. The Expert range is intended as a long chase.

## Vary the deliveries

The `DELIVERIES` table is immediately below `TUNING` near the top of `game.js`. It now includes slow topspin and backspin, regular spin, a faster straight ball, fast balls with spin, and a **high full toss**. The game chooses a weighted preset, avoids repeating the same name twice in a row, then randomly picks values inside that preset's ranges.

```js
{name:'FAST TOPSPIN',weight:8,speed:[465,520],
 startY:[135,175],launchVy:[-74,-45],spin:[-28,-19],bounce:[.61,.69]}
```

| Field | Effect |
| --- | --- |
| `weight` | Relative frequency. Raise a preset's weight to see it more often. The current weights add to 100; consecutive duplicates are excluded. |
| `speed` | Horizontal launch speed. Larger values arrive sooner. Slow spin is about `235–290`; fast deliveries are about `460–565`. The straight fast ball is now the quickest. |
| `startY` | Launch height. **Smaller `y` means higher** on the screen. The full toss uses `65–85`. |
| `launchVy` | Initial vertical speed. More negative values rise longer before falling. |
| `spin` | Negative values mean topspin for a ball moving left: it dips sooner. Positive values mean backspin: it floats longer. Values near zero make a straighter ball. |
| `bounce` | How much vertical speed survives a bounce: lower numbers keep the bounce lower. |

To add a delivery, copy a row, give it a unique `name`, and set ranges for all five physical values. The weighted picker automatically includes the new row. `pickDelivery` chooses the preset; `spawn` creates its ball. The high full toss reaches the batter around upper body height before bouncing. These values are arcade tuning rather than measurements from the Flash game.

## Find the motion and physics code

| Function | What it does |
| --- | --- |
| `aim` | Converts screen pointer coordinates into 800 × 520 field coordinates. |
| `moveBody` | Springs the shoulder, hips, and helmet toward a mouse-driven lean. The first `targetX` line controls how far the batter bends backward. The `spring` calls set looseness and settling. |
| `moveBat` | Springs bat angle and hand reach toward the pointer. Values `290`/`32` control angular responsiveness/damping, and `260`/`30` control reach. |
| `poseBat` | Computes the **same** hand and tip endpoints used for the drawing and collisions. |
| `drawPlayer`, `drawPad`, `drawGlove`, `drawBat`, `drawWicket` | Draw the player kit, jointed limbs, bat, and stumps. Colors and visual details live here. |
| `pickDelivery`, `spawn` | Pick one weighted delivery and randomize its pace, launch, spin, and bounce. |
| `randomTarget`, `reset`, `award`, `win`, `end`, `drawHud` | Draw a random integer from the selected range, add runs, finish a chase or an out, and display progress. |
| `advanceBall` | Applies gravity, air drag, Magnus spin, bounce, and ground friction. |
| `hitBat` | Finds bat/ball contact and applies the hit impulse, spin, and batting assist. |
| `batHitsWicket`, `ballTouchesWicket`, `fallWicket` | Detect contact with a stump or bail, then animate the fall. |
| `boundary`, `award`, `rate` | Runs and score rules. |
| `step`, `tick`, `render` | Fixed 1/120-second updates and screen drawing. |

The bat follows this geometry in `poseBat`:

```js
bat.tx = body.sx + Math.cos(bat.angle) * bat.radius;
bat.ty = body.sy + Math.sin(bat.angle) * bat.radius;
bat.hx = body.sx + Math.cos(bat.angle) * (bat.radius - BL);
bat.hy = body.sy + Math.sin(bat.angle) * (bat.radius - BL);
```

`(tx, ty)` is the tip and `(hx, hy)` is the hand. The blade is drawn between them. Collision checks sample that segment throughout a swing, rather than testing only the last frame.

Ball flight begins in `advanceBall`:

```js
const ax = -AIR_DRAG * speed * b.vx - MAGNUS * b.spin * b.vy;
const ay = GRAVITY - AIR_DRAG * speed * b.vy + MAGNUS * b.spin * b.vx;
b.vx += ax * dt;
b.vy += ay * dt;
```

Change `GRAVITY`, `AIR_DRAG`, or `MAGNUS` at the top of `game.js` to tune overall flight; edit the `DELIVERIES` rows to change individual deliveries. `advanceBall` also contains bounce and friction after the ball touches the ground. These are intentionally simplified 2D physics.

The display uses `runs / delivered` as its rate and `Math.floor(runs * rate)` as the final score, both on a win and an out. The exact original Flash game's scoring code is unavailable.
