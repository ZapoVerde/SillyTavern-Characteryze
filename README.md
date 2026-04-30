


Here is an updated `README.md` designed specifically for everyday users. It strips away the technical jargon and focuses entirely on what the extension does, how to set it up, and how to use it in your day-to-day writing.

***

# Characteryze

**Characteryze** is a SillyTavern extension that turns your AI into a collaborative writing assistant. 

Have you ever wanted to chat with an AI to brainstorm character details, tweak a system prompt, or design a portrait, but didn't want to mess up your actual chat history or accidentally overwrite your character cards? 

Characteryze solves this by providing a safe, isolated workspace. It lets you generate content in a sandbox, review it side-by-side with your live settings, and explicitly "commit" only the parts you like.

---

## What It Does

Characteryze places a tabbed overlay on top of SillyTavern. It uses a **Forge → Workbench** workflow:

1. **The Forge:** A private sandbox chat. You talk to the AI, ask it to write descriptions, dialogue examples, or image prompts. 
2. **The Workbench:** A drafting table. It automatically scans your Forge chat for anything the AI wrote in codeblocks (like ` ```description `). You can click on these blocks, edit them, and map them to your real SillyTavern fields.
3. **Draft & Commit:** Nothing is actually written to your character card or settings until you click **Commit**. You are always safe to experiment.

---

## Features

* **Character Crafting:** Effortlessly draft and update Character Names, Descriptions, Personalities, Scenarios, and First Messages.
* **System Prompt Tuning:** Modify your Main Prompts, NSFW Prompts, and Jailbreaks without navigating away from your brainstorming session.
* **Ruleset Library:** Create custom instructions (like "Write like a sci-fi author" or "Use dark fantasy themes") and toggle them on and off to easily guide the AI's behavior in future generations.
* **Portrait Studio:** Built-in image generation. Ask the AI for a `portrait-prompt`, generate an image using Pollinations, and instantly attach it as your character's avatar.
* **No Mess:** When you launch Characteryze, your current settings are saved. When you click **Close**, you are returned to SillyTavern exactly as you left it.

---

## First-Time Setup

Before you use Characteryze for the first time, you need to do two quick things:

### 1. Create the Host Character (Required)
To keep your sessions completely isolated from your normal chats, Characteryze needs an empty character to act as the host.
1. Open SillyTavern and create a **new, blank character**.
2. Name the character exactly: **`Characteryze Host`**
3. Save it. You never need to look at or chat with this character manually.

### 2. Add your Pollinations Key (Optional, for Portraits)
If you want to use the Portrait Studio to generate character images:
1. Open the Characteryze extension drawer and launch the app.
2. Go to the **Settings** tab.
3. Paste your Pollinations API key into the Vault and click **Save**. 

---

## How to Use Characteryze (The Core Loop)

### Step 1: Launch and Focus
Open the SillyTavern extensions drawer, find Characteryze, and click **Launch**. 
In the **Home** tab, choose your Focus:
* **Canvas:** What are you making? (Character Card, System Prompt, or Ruleset).
* **Target:** Who are you editing? (Choose an existing character to edit, or select `< New Character >`).
* Click **Enter Forge**.

### Step 2: Brainstorm in the Forge
You are now in an isolated chat. Ask the AI to write what you need. 
* *Tip:* Tell the AI to output its ideas in markdown codeblocks (e.g., *"Write a detailed physical description for a rogue and put it in a \`\`\`description\`\`\` codeblock."*). Characteryze looks for these blocks automatically.

### Step 3: Stage in the Workbench
Switch to the **Workbench** tab. 
1. On the left, you'll see a list of all the codeblocks the AI just generated.
2. Click one to load it into your **Draft** pane.
3. Use the dropdown menu above to select which field this text belongs to (e.g., *Personality*, *Scenario*, etc.).
4. Edit the text in the Draft pane however you like. 

### Step 4: Commit
Once you are happy with your draft, click the blue **Commit** button. This is the moment your changes are actually saved to SillyTavern. 

*If you change your mind, you can just close the app—uncommitted drafts will be waiting for you next time, but won't affect your live SillyTavern data.*

---

## Managing Rulesets

Rulesets are instruction manuals for your AI. Instead of typing "Be highly descriptive and write in third-person" every time you chat, you can save it as a Ruleset.

1. Go to the **Home** tab and set the Canvas to **Ruleset**.
2. Go to the **Workbench**, name your Ruleset, write your instructions, and **Commit**.
3. Anytime you are in the Forge, you can open the **Rulesets** tab and simply check the boxes next to the rules you want active. Characteryze handles injecting them into your prompt silently!

---

## Safely Exiting

When you are done brainstorming, click the X button at the top right.

Characteryze will gracefully pack up its workspace, clear away the sandbox, and restore your SillyTavern connection profiles and chat screen back to normal.