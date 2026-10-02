# Get your free Azure Speech key

**Draft for the onboarding test.** Screenshots will be added after a first-time user has gone through these steps.

Pronunciation Coach uses Microsoft's speech service. Each person uses their own free key. It takes about 10 minutes, once.

You need: an email address, a phone number, and a bank card. Microsoft uses the card only to check that you are a real person. The **Free F0** plan in step 3 cannot charge you: when the free monthly allowance runs out, the service simply stops working until next month.

## 1. Create a free Azure account

1. Go to <https://azure.microsoft.com/free> and click the button to start for free.
2. Sign in with a Microsoft account, or create one.
3. Fill in the form: phone check, card check, accept the terms.
4. When you see the Azure portal home page, the account is ready.

## 2. Open the Speech creation form

Open this link: <https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices>

You should see a page titled **Create Speech Services**.

> Create exactly this kind of resource ("Speech Services"), not a "Foundry" or "Azure AI services" resource. The app and this guide are tested with Speech Services on the Free F0 plan.

## 3. Fill in the form

| Field | What to choose |
| --- | --- |
| Subscription | Leave the default. |
| Resource group | Click **Create new**, type `pronunciation-coach`, click OK. |
| Region | Choose one near you, for example **West Europe**. **Write it down.** |
| Name | Any name that is not taken, for example `pc-yourname`. A green check appears when it is free. |
| Pricing tier | **Free F0**. If Free F0 is not in the list, see "Problems" below. |

Click **Review + create**, then **Create**. Wait about a minute until you see **Your deployment is complete**, then click **Go to resource**.

## 4. Copy the key and note the region

1. In the left menu, open **Resource Management → Keys and Endpoint**.
2. Copy **KEY 1** (the copy button is at the right of the field).
3. Note **Location/Region**, for example `westeurope`. You will pick the same region from a list in the app.

> Pick the region of this resource, not the one you are in. A key works only with its own region.

## 5. Paste them into the app

Open Pronunciation Coach, paste the key, choose the region from the list, and press **Save key**. The app checks the key right away.

## Keep your key safe

- Use only the official site of this app, not copies of it.
- Do not post the key anywhere. If you think someone has seen it, go to **Keys and Endpoint** in the Azure portal and click **Regenerate Key 1**, then paste the new key into the app.
- A leaked Free F0 key cannot cost you money, but someone could use up your free monthly allowance.

## Problems

- **Free F0 is not in the Pricing tier list.** Azure allows one free Speech resource per region in each subscription. Either you already have one in this region (use its key instead), or you deleted one recently. In that case, pick a different region, or purge the deleted resource and wait up to 48 hours.
- **"Key or region rejected" in the app.** Check that the region in the list is the one shown in step 4 for the same resource as the key.
- **"This key is already in use."** A free key allows one recording at a time. Close other tabs or devices that use the same key, and try again.
