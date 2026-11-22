# Flurry

Freeze your favorite moments!

Flurry is a website that turns your videos into cute, customizable snow globes. Pick your favorite frames, decorate your globe, and save it on a cozy virtual shelf. You can even shake it to replay your memories!

Live demo: https://radhana-mainali.github.io/flurry/

Made for Hack Club Snowglobe 2026

Made by Radhana, Deborah, and Noelle
<img width="1440" height="900" alt="Screenshot 2026-11-22 at 2 51 54 PM" src="https://github.com/user-attachments/assets/cea86939-42c8-4fc0-8634-7b4dc79954d2" />
<img width="1440" height="900" alt="Screenshot 2026-11-22 at 2 53 21 PM" src="https://github.com/user-attachments/assets/50f21c3b-dc94-4563-a436-a78a7dea471e" />

## What is Flurry?

We wanted to make something that would help people revisit all those random videos sitting in their camera rolls.

With Flurry, you can upload a video, choose three moments from it, and turn them into a little snow globe. You can add stickers, a date, and a memory name before saving it to your shelf.

Our favorite part is that when you shake a globe, the snow swirls and your video moments play back with sound!

We also drew our own snow globes, stickers, shelves, and cozy winter cabin to give everything a handmade feel.

## How to use it

1. Click the snow globe to upload a video.
2. Flurry picks 10 clear frames. Choose your favorite three.
3. Decorate your globe with stickers, a date, and a name.
4. Save it to your shelf.
5. Click a saved globe and shake it to replay your memories!

## How we built it

We used HTML, CSS, and JavaScript, along with the Canvas and video APIs.

For frame selection, we sample frames from the uploaded video and use variance of the Laplacian to estimate how sharp they are. We then suggest 10 frames from different parts of the video.

We used CSS and JavaScript to layer the chosen images inside our snow globe drawings, animate snowfall, and make the globes interactive.

The site is hosted on GitHub Pages, and memories are saved in the browser.

All of our illustrations were made by our team!

## Run it yourself!

Clone the repo:

```bash
git clone https://github.com/radhana-mainali/flurry.git
cd flurry
```

Start a local server:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000 in your browser.

No API keys or installation dependencies are needed.

## Challenges

Getting the photos to fit: Our snow globe has three tilted photo openings, so lining everything up with the illustration took a lot of trial and error.

Finding good frames: We didn't want blurry or repetitive photos, so we added a sharpness algorithm and spread the suggestions across the video.

Saving the globes: Our first saved globes were blurry, and getting them to sit properly on the wooden shelves was harder than we expected.

Replaying memories: Connecting still frames back to the original video, while keeping the snow animation and audio working, was another challenge.

## Next steps

We'd love to add sharing so you can send snow globes to friends, more decorations, and smarter frame selection that can recognize people, scenery, and objects.

We also want to refit the shelf page for phones.
