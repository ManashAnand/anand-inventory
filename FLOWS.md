# Inventory flows

The app is a local catalog for Anand Communication. Products, bills, shop details, and the letterhead live in a folder you choose. That folder can be copied to another computer or to Google Drive. The computer itself only remembers where the folder is, and whether a signed access code has been entered.

The screens stay locked until a code is accepted. After that, the app opens the inventory folder and the sidebar pages share the same products, stock, and shop details.

```text
Access code
    ↓
Choose or create the inventory folder
    ↓
Products  ←—— stock in / stock out ——→  New bill
    ↓                                      ↓
Settings (shop, letterhead, next code)   Past bills
```

## Access codes

This is the gate in front of every other screen. On launch the app asks for a signed code. There is no automatic trial. Products and bills are not touched while the screens are locked.

A code is made on the developer Mac, the only machine that has `license/private.pem`:

```bash
npm run license -- trial
npm run license -- month
npm run license -- quarter
npm run license -- lifetime
```

The command prints a code that starts with `ANAND.` and the date it lasts through.

| Command | What it opens |
| --- | --- |
| `trial` | 10 days, including the day the code is made |
| `month` | Through the date 30 days after the command is run |
| `quarter` | Through the date 90 days after the command is run |
| `lifetime` | No end date |

The end date is inside the signature. Pasting the same code again, even after the local access files are deleted, still ends on that date. A new period starts only when the command is run again and a new code is pasted.

The app checks the code with the public key built into the program. An expired or altered code leaves the shop locked. While a trial code is active, the sidebar shows how many days are left. A month or quarter code shows “Access until {date}”. A lifetime code shows “Lifetime access”.

The accepted code is sealed and stored in three places on the computer: the app’s own data folder, a second copy under the application support folder, and, on a Mac, the keychain. Editing one copy does not start a new period. Deleting every copy looks like a first launch, which still requires a code.

A code can also be pasted later from Settings. That replaces the current code without moving the inventory folder.

**Connects to:** every other flow. Inventory, products, bills, and settings load only after the code is accepted. Settings is where a later code is entered. The inventory folder is separate from the access record, so locking the screens does not delete stock or bills.

## Inventory folder

This is the shared store for the shop. The path is saved only on this computer, in the app’s config. Everything else travels with the folder:

```text
YourInventory/
  inventory.json          shop name, currency, address, phone, email
  banner.png              letterhead used on bills
  products/
    {name}__{id}/
      product.json
      images/
  bills/
    YYYY-MM-DD/
      0001.json
      log.txt
```

`inventory.json` holds the shop name, a 3-letter currency such as INR, and the address, phone, and email printed on bills. Each product is its own folder, so a photo sits next to `product.json`. Bills are grouped by the calendar day on the invoice. `log.txt` in that day folder is a readable copy of the same bills.

Older bills that were saved as flat files directly under `bills/` are moved into the matching date folder the next time bills are read.

Copying the folder to another computer, or opening the same folder from Google Drive, brings the catalog back. The other computer still needs its own access code. The folder path on the new computer is chosen again during setup.

**Connects to:** setup, products, bills, past bills, and settings. Products write stock here. A saved bill subtracts stock here and adds a bill file. Deleting a bill adds the stock back. Settings writes the shop details and the banner into this same folder. Access codes are not stored here.

## First launch and choosing a folder

After a code is accepted, the app looks for a saved folder path.

- No path yet: the setup screen asks you to create a new inventory or open an existing one.
- The path is missing, or the folder is no longer an inventory: the setup screen says so and asks you to choose the folder again.
- The folder was written by a newer version of the app: it stays closed until the app is updated.
- The folder is already an inventory: it opens straight to Products.

Creating a folder writes `inventory.json` and copies the default letterhead in as `banner.png` when the folder does not already have a banner. Opening an existing inventory does not overwrite the shop name. Choosing a plain folder that already has files asks for confirmation before an inventory file is added. Files already in that folder are left in place.

**Connects to:** the access code, which must pass before this screen appears, and to every later page, which read this folder. Settings can switch to a different folder later.

## Navigation

The sidebar has Products, New bill, Past bills, and Settings. Back returns to the previous page, the way a browser back button does. It does not jump straight to Products unless Products is the page underneath.

Pages you have opened stay mounted but hidden, so a half-written product or bill is still there when you come back to it. Leaving a product form or a bill that has unsaved changes asks you to confirm.

Saving a product clears the history and returns to the product list. “Save and add another” stays on a fresh product form. `⌘N` on a Mac, or `Ctrl+N` on Windows, opens a new product from anywhere in the shop.

**Connects to:** products, billing, past bills, and settings. The back button is how you move between them without losing a draft. Saving a product is the one action that resets the trail to the product list.

## Products

The product list is the home page. Each card shows the title, selling price, cost, and how many units are in stock. Opening a card edits that product. New product starts a blank form.

A product stores a title, brand, category, SKU, selling price, purchasing price, units, description, notes, an optional cover photo, and optional color photos. Photos can be JPG, PNG, WebP, or GIF, and can be left empty. The selling price can match the purchasing price and cannot be lower. Missing units are read as zero.

Saving writes `product.json` and copies any new photos into that product’s folder. Deleting a product removes its folder. The list refreshes when you return to it, so stock changed by a bill shows up.

**Connects to:** the inventory folder, which holds each product. New bill reads these products, uses the selling price as the starting line price, and will not sell more units than are in stock. Saving a bill reduces `units`. Deleting a bill from Past bills or from the bill screen adds those units back. If the product folder is already gone, the bill is still deleted and the screen says the stock could not be restored.

## New bill

New bill builds one invoice from the current stock. It has an edit tab and a preview tab.

The form has:

- Company name, address, phone, and email. Empty address, phone, and email start from the shop defaults. The shop name is never replaced by a default.
- Invoice date. This date decides which `bills/YYYY-MM-DD/` folder the bill is saved in.
- Invoice number, shown as `INV-0001` and upward. It is not typed. The number is one higher than the highest bill already in the folder, and it is assigned when you save.
- Customer name, address, phone, and email.
- Lines picked from products in stock. The selling price can be changed for this bill only. Quantity cannot go above the units in stock. The same product added twice is combined.
- Notes.
- GST at 0, 5, 12, 18, or 28 percent, added on top of the line totals.
- Payment: Cash, UPI, Card, or Credit.

The preview shows the letterhead from the inventory folder, then the invoice. If the folder has no banner, the built-in letterhead is shown.

Save writes the bill, subtracts stock, and refreshes that day’s `log.txt`. A custom selling price on the bill does not change the catalog price. Changing the company details on the bill also saves them into the inventory folder so the next bill starts from them.

After a bill exists you can:

- Export Excel, which saves a CSV of that invoice.
- Download PDF, which prints the preview to a PDF file.
- Share on WhatsApp, which opens WhatsApp with the invoice text.
- Delete, which removes the bill file and puts the units back on the products that still exist.

**Connects to:** products for stock and the starting price, settings and `inventory.json` for the company details, the banner file for the preview, and past bills, which read the same saved files. The “Past bills” link on this screen is a normal forward step, so Back returns to the bill you were writing.

## Past bills

Past bills lists every saved invoice, grouped by the invoice date. Opening one shows the same invoice preview as New bill, including Excel, PDF, and WhatsApp.

Filters:

- Product name or SKU.
- Bill total greater than, less than, or exactly an amount.
- A single date.

The summary under the filters counts the matching bills, the matching units, and the matching amount. When a product name is typed, the units and amount count only the lines that match that product, not the whole bill.

Deleting a bill removes its JSON file, rewrites that day’s `log.txt`, and restores stock. A product that no longer exists is reported, and the bill is still deleted. If that day has no bills left, the day folder is removed.

**Connects to:** the bill files written by New bill, and the product folders whose stock comes back on delete. The product list shows the restored units the next time it loads.

## Settings

Settings edits the shop record stored in the inventory folder: shop name, currency, address, phone, and email. Saving updates `inventory.json`. The next new bill starts from those details.

The letterhead preview reads `banner.png` (or jpg, jpeg, webp, gif) from the inventory folder. Change banner replaces that file. The banner travels with the folder, so another computer sees the same header.

Change folder points this computer at a different inventory, or creates one in an empty folder. That does not change the access code.

The access section is the same code box as the lock screen. Pasting a new valid code switches the plan. The products and bills stay in the current folder.

Show in folder opens the inventory folder in Finder or Explorer.

**Connects to:** the inventory folder for shop details, currency, and the banner. New bill and Past bills print those details and format money with that currency. The access section is the same flow as the lock screen, used after the shop is already open.

## What moves, and what stays on the computer

| Travels with the inventory folder | Stays on this computer |
| --- | --- |
| Shop name, currency, address, phone, email | The path to the folder |
| Products, photos, and stock | The accepted access code |
| Bills and each day’s `log.txt` | |
| The letterhead | |

Opening the folder on a second computer restores the catalog. That computer still needs its own code from `npm run license`. The private key stays on the developer Mac and is not part of the app or the inventory folder.
