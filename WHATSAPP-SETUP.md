# WhatsApp reminders

Switched on in the app: **My account (person icon) → WhatsApp** (owners only).
This guide covers getting the keys to paste there.

First update your server so it has the latest features. Open the SSH window
and run the install command again:

```bash
curl -fsSL https://raw.githubusercontent.com/MFD-14/Farm-Manager/main/scripts/install-server.sh | sudo bash
```

Your data, accounts and passwords are kept.

**How evidence is checked.** Photos, videos and voice notes are not checked by
a machine. They upload with the task (from the app, or as a WhatsApp reply) and
the task waits in **Review → Ready to accept** until an owner or task manager
taps **Accept**, or **Send back** with a reason. The caretaker gets the reason
on WhatsApp.

---

## Setting up WhatsApp

**What it does**

- **Overdue reminders** go to whoever the task is assigned to. A single task
  comes with **Done / Problem / Skip** buttons; several overdue tasks come as one
  list.
- **Morning task list** at the time you choose (default 06:00).
- **Sent-back notices** when an owner or task manager sends a task back, with
  the reason.
- **Alerts to owners and task managers** when a task is missed twice, plus the
  19:00 digest.
- The caretaker can **reply with a photo**. It attaches to the task; if several
  tasks are open, the farm number asks "Which task is this for?" and a number
  reply attaches it. Typing `done`, `problem` or `skip` also works.

**What it costs.** Meta charges per message, by country. Messages sent within
24 hours of the person last messaging the farm number are plain messages,
covered by 1,000 free messages a month. Messages outside that window must use an
approved template and are billed (a few US cents each for Zimbabwe). Ask the
caretaker to message the farm number often (any reply, a photo, "done"); that
keeps most reminders free. Check Meta's current rates in WhatsApp Manager.

### 1. A phone number for the farm

You need a number that can receive an SMS or call and **isn't registered on the
WhatsApp app**. A new SIM is easiest. If you use a number that's already on
WhatsApp, delete that WhatsApp account first. Don't use your personal number.

### 2. Create the Meta app

1. Go to <https://developers.facebook.com>, sign in with Facebook, and choose
   **My Apps → Create app**.
2. Choose the use case **Connect with customers through WhatsApp**. Name it
   `Woodlands Farm`, and create or choose a business portfolio (for example
   Musara Holdings LLC).
3. In the app, open **WhatsApp → API Setup**, then **Add phone number**. Enter
   the farm number, display name `Woodlands Farm`, and confirm with the code
   Meta sends.
4. Copy the **Phone number ID** shown for the farm number (not the test number).

### 3. A permanent access token

The token on the API Setup page expires after 24 hours, which is fine for a quick
try. For everyday use:

1. Go to <https://business.facebook.com/settings>, then **Users → System users →
   Add**. Name it `woodlands`, with role **Admin**.
2. **Assign assets**: give it the `Woodlands Farm` app (full control) and your
   WhatsApp account (full control).
3. **Generate new token**: pick the app, set expiry **Never**, and tick
   `whatsapp_business_messaging` and `whatsapp_business_management`. Copy the
   token.

### 4. App secret

In the Meta app: **App settings → Basic → App secret → Show**. Copy it. With it,
Woodlands refuses any message that didn't really come from Meta.

### 5. Paste into Woodlands

In **My account → WhatsApp**, paste the **access
token**, **phone number ID** and **app secret**, then tap **Save**. The card now
says **Connected**.

### 6. Connect the webhook (so replies and photos reach Woodlands)

1. In the Meta app: **WhatsApp → Configuration → Webhook → Edit**.
2. Paste the **Callback URL** and **Verify token** from the Woodlands card, using
   the two Copy buttons. Tap **Verify and save**.
3. Under **Webhook fields → Manage**, subscribe to **messages**.
4. In **App settings → Basic**, set the **Privacy policy URL** to
   `https://<your server>/privacy.html`. Then switch the app to **Live** at the
   top of the dashboard.

### 7. Add a payment method

In **WhatsApp Manager** (business.facebook.com/wa/manage), go to **Payment
settings** and add a card. Template messages need it.

### 8. Create the message templates

In the Woodlands card, tap **Show the 5 message templates**. For each one, go to
**WhatsApp Manager → Message templates → Create template**:

- **Category:** Utility. **Name:** exactly as shown (Copy button). **Language:**
  English.
- **Body:** the text exactly as shown, including `{{1}}`, `{{2}}`. Add the sample
  values shown.
- For `woodlands_task_reminder`, add three **Quick reply** buttons: `Done`,
  `Problem`, `Skip`.
- Submit. Approval usually takes minutes to a few hours.

The templates are:

| Name | Body |
|---|---|
| `woodlands_task_reminder` | Reminder from Woodlands Farm: {{1}} was due at {{2}}. Please do it now and tap a button below when it is done. *(quick replies: Done, Problem, Skip)* |
| `woodlands_overdue_list` | Woodlands Farm: you have {{1}} overdue tasks: {{2}}. Please open the Woodlands app to record them. |
| `woodlands_morning_plan` | Good morning {{1}}. You have {{2}} farm tasks today: {{3}}. Open the Woodlands app to see the details. |
| `woodlands_task_sent_back` | Woodlands Farm: {{1}} was sent back. Reason: {{2}}. Please redo it and record it in the Woodlands app. |
| `woodlands_owner_alert` | Woodlands Farm alert: {{1}}. Open the Woodlands app for details. |

If WhatsApp Manager saves the language as English (US), set **Template language
code** in the Woodlands card to `en_US`.

### 9. Phone numbers and a test

1. In **People**, give each person their WhatsApp number (`0771234567` is fine;
   it becomes `+263771234567`). Each person can switch WhatsApp messages off.
2. Ask the caretaker to send **hi** to the farm number. That opens the free
   window and lets Woodlands recognise him.
3. In the Woodlands card, pick a person and tap **Send test**. Before your
   templates are approved, a test to someone who hasn't messaged the farm number
   uses Meta's `hello_world` sample.

The **Recent messages** list on the card shows every message with its result
(sent, delivered, read, failed and why). Failures often mean a template isn't
approved yet, or a number isn't on WhatsApp.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| "Template name does not exist" | The template isn't approved yet, the name differs, or the language code doesn't match. |
| "Recipient phone number not in allowed list" | The Meta app is still in development mode with Meta's test number. Use the farm number and switch the app to Live. |
| Webhook "Verify and save" fails | The server address must be the https one and reachable. Copy the URL and token again from the card. |
| Replies don't do anything | Subscribe the webhook to **messages**; check the sender's number is on their account under People. |
| A task with a photo isn't in Review | The photo hasn't finished uploading. On the caretaker's phone, tap the sync badge to see the upload and retry. After 24 hours it appears in Review anyway, flagged. |

Environment variables (`WA_TOKEN`, `WA_PHONE_ID`, `WA_APP_SECRET`,
`WA_VERIFY_TOKEN`, `WA_API_VERSION`) still work as defaults; settings saved in
the app take priority.
