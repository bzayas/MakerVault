#!/usr/bin/env python3
"""Fill an EMPTY MakerVault instance with demo data for screenshots.

Everything goes through the public API, so the data is shaped exactly the
way the app would create it. Never point this at the live NAS: it only adds
records, but they are fake.

Usage: seed_demo.py http://127.0.0.1:8790
"""

import datetime as dt
import json
import random
import sys
import urllib.request

BASE = sys.argv[1].rstrip("/") + "/api"
TODAY = dt.date(2026, 9, 28)
random.seed(7)


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + "/" + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read() or b"null")


def days_ago(n):
    return (TODAY - dt.timedelta(days=n)).isoformat()


# --- Locations ---------------------------------------------------------------

def loc(name, type_, parent=None, qr=None):
    body = {"name": name, "type": type_, "parent_id": parent}
    if qr:
        body["qr_code_value"] = qr
    return call("POST", "locations.php", body)["id"]


L = {}
L["garage"] = loc("Garage Workshop", "custom")
L["rack"] = loc("Closet Rack", "closetRack", L["garage"], "makervault://loc/rack")
for n in (1, 2, 3):
    L[f"shelf{n}"] = loc(f"Shelf {n}", "shelf", L["rack"], f"makervault://loc/shelf-{n}")
L["bin_screws"] = loc("Screw Bin A", "gridfinityBin", L["shelf1"])
L["bin_nuts"] = loc("Nuts & Inserts Bin", "gridfinityBin", L["shelf1"])
L["bin_elec"] = loc("Electronics Bin", "gridfinityBin", L["shelf2"])
L["bin_motors"] = loc("Motors Bin", "ikeaBin", L["shelf2"])
L["bin_adhesive"] = loc("Glue & Tape", "wallBin", L["shelf3"])
L["cart"] = loc("Rolling Cart", "rollingCart", L["garage"])
for n in (1, 2, 3):
    L[f"layer{n}"] = loc(f"Layer {n}", "cartLayer", L["cart"])
L["sortmaster"] = loc("Stanley Sortmaster", "stanleySortmaster", L["layer1"])
for n in range(1, 5):
    L[f"comp{n}"] = loc(f"Compartment {n}", "sortmasterCompartment", L["sortmaster"])
L["drybox"] = loc("Filament Dry Box", "dryBox", L["garage"], "makervault://loc/drybox")
L["toolbox"] = loc("Red Toolbox", "toolBox", L["garage"])
L["desk"] = loc("Office Desk", "custom")
L["desk_drawer"] = loc("Top Drawer", "drawer", L["desk"])

# --- Items -------------------------------------------------------------------

ITEMS = []


def item(name, category, qty, unit="pcs", **kw):
    body = {"name": name, "category": category, "quantity": qty, "unit": unit}
    body.update(kw)
    created = call("POST", "items.php", body)
    ITEMS.append(created)
    return created


def filament(name, material, color, hex_, qty=1, mode="solid", extra=None, **kw):
    fil = {"material": material, "color": color, "color_hex": hex_,
           "color_mode": mode, "spool_weight": 1000,
           "remaining_weight": kw.pop("remaining", 1000), "spool_type": "withSpool"}
    fil.update(extra or {})
    return item(name, "filament", qty, "spools", filament=fil, **kw)


bambu = dict(vendor="Bambu Lab", brand="Bambu Lab")
F = {}
F["pla_black"] = filament("PLA Basic Black", "PLA", "Black", "#1A1A1A", 3, sku="10101",
                          purchase_price=19.99, purchase_date=days_ago(12),
                          location_id=L["drybox"], min_quantity=2, **bambu)
F["pla_white"] = filament("PLA Basic Jade White", "PLA", "Jade White", "#F2F1EC", 2, sku="10100",
                          purchase_price=19.99, purchase_date=days_ago(12),
                          location_id=L["drybox"], min_quantity=2, **bambu)
F["pla_red"] = filament("PLA Basic Red", "PLA", "Red", "#C8102E", 1, sku="10200",
                        purchase_price=19.99, purchase_date=days_ago(70),
                        location_id=L["drybox"], remaining=420, **bambu)
F["matte_blue"] = filament("PLA Matte Marine Blue", "PLA Matte", "Marine Blue", "#1F4E8C", 1,
                           sku="11600", purchase_price=21.99, purchase_date=days_ago(40),
                           location_id=L["drybox"], **bambu)
F["silk_dual"] = filament("PLA Silk Dual Gold-Silver", "PLA Silk Duo-Color", "Gold-Silver", "#D4AF37",
                          1, mode="split", extra={"color_hex2": "#C0C0C0"},
                          purchase_price=24.99, purchase_date=days_ago(95),
                          vendor="Amazon", brand="ERYONE", location_id=L["drybox"])
F["galaxy"] = filament("PLA Galaxy Purple", "PLA Galaxy", "Galaxy Purple", "#4B2E83", 1,
                       mode="sparkle", purchase_price=22.49, purchase_date=days_ago(150),
                       location_id=L["drybox"], **bambu)
F["gradient"] = filament("PLA Basic Gradient Ocean", "PLA Gradient", "Ocean", "#0077B6", 1,
                         mode="gradient", extra={"color_hex2": "#90E0EF", "color_hex3": "#023E8A"},
                         purchase_price=24.99, purchase_date=days_ago(180),
                         location_id=L["drybox"], **bambu)
F["petg"] = filament("PETG HF Gray", "PETG HF", "Gray", "#8A8D8F", 2, sku="33102",
                     purchase_price=21.99, purchase_date=days_ago(25),
                     location_id=L["drybox"], **bambu)
F["tpu"] = filament("TPU 95A HF Black", "TPU", "Black", "#111111", 1,
                    purchase_price=41.99, purchase_date=days_ago(210),
                    location_id=L["drybox"], remaining=650, **bambu)
F["asa"] = filament("ASA White", "ASA", "White", "#FAFAFA", 0, min_quantity=1,
                    purchase_price=23.99, purchase_date=days_ago(260),
                    location_id=L["drybox"], **bambu)
F["support"] = filament("Support for PLA/PETG", "Support for PLA/PETG", "Black", "#2B2B2B", 1,
                        purchase_price=34.99, purchase_date=days_ago(120),
                        location_id=L["drybox"], **bambu)
F["polymaker"] = filament("PolyTerra PLA Forest Green", "PLA Matte", "Forest Green", "#2E5E3A", 2,
                          purchase_price=17.99, purchase_date=days_ago(55), vendor="Amazon",
                          brand="Polymaker", location_id=L["drybox"])

item("M3x8 BHCS Machine Screw", "screws", 180, pack_quantity=200, purchase_price=8.99,
     purchase_date=days_ago(33), vendor="Amazon", brand="uxcell", location_id=L["comp1"],
     min_quantity=50, subcategory="Button Head", description="Pack of 200, 304 stainless")
item("M3x12 BHCS Machine Screw", "screws", 34, pack_quantity=100, purchase_price=6.49,
     purchase_date=days_ago(33), vendor="Amazon", brand="uxcell", location_id=L["comp1"],
     min_quantity=40, subcategory="Button Head")
item("M4x16 SHCS Machine Screw", "screws", 75, pack_quantity=100, purchase_price=9.29,
     purchase_date=days_ago(140), vendor="McMaster-Carr", location_id=L["comp2"],
     subcategory="Socket Head", sku="91292A124")
item("M2.5x6 BHCS Machine Screw", "screws", 0, pack_quantity=100, purchase_price=5.99,
     purchase_date=days_ago(300), vendor="Amazon", location_id=L["comp2"], min_quantity=20)
item("M3 Heat-Set Inserts (5mm)", "hardware", 140, pack_quantity=200, purchase_price=12.99,
     purchase_date=days_ago(48), vendor="Amazon", brand="Ruthex", location_id=L["bin_nuts"],
     custom_fields={"Install temp": "220 °C", "Hole size": "4.0 mm"})
item("M3 Nylock Nut", "hardware", 220, pack_quantity=250, purchase_price=7.49,
     purchase_date=days_ago(48), vendor="Amazon", location_id=L["bin_nuts"])
item("6x3mm Neodymium Magnets", "hardware", 96, pack_quantity=100, purchase_price=9.99,
     purchase_date=days_ago(88), vendor="Amazon", location_id=L["comp3"])
item("608ZZ Ball Bearing", "hardware", 14, pack_quantity=10, purchase_price=7.99,
     purchase_date=days_ago(160), vendor="Amazon", location_id=L["comp3"], min_quantity=8)
item("Cork Pads 10mm", "hardware", 1800, pack_quantity=2000, purchase_price=11.49,
     purchase_date=days_ago(205), vendor="Amazon", location_id=L["comp4"])

item("N20 Reduction Gear Motor 300rpm", "motor", 6, purchase_price=4.25, purchase_date=days_ago(66),
     vendor="Amazon", location_id=L["bin_motors"])
item("MG90S Micro Servo", "motor", 3, purchase_price=3.80, purchase_date=days_ago(66),
     vendor="Amazon", location_id=L["bin_motors"], min_quantity=4)
item("NEMA 17 Stepper Motor", "motor", 2, purchase_price=13.99, purchase_date=days_ago(230),
     vendor="StepperOnline", location_id=L["bin_motors"])

item("ESP32-S3 DevKitC", "electronic", 4, purchase_price=11.50, purchase_date=days_ago(18),
     vendor="DigiKey", brand="Espressif", sku="ESP32-S3-DEVKITC-1-N8R8", location_id=L["bin_elec"],
     barcode="MV-ELE-00001")
item("WS2812B LED Strip 1m", "electronic", 3, purchase_price=8.99, purchase_date=days_ago(18),
     vendor="Amazon", unit="rolls", location_id=L["bin_elec"])
item("200mm Servo Extension Cable 3Pin", "electronic", 8, pack_quantity=2, purchase_price=1.97,
     purchase_date=days_ago(75), vendor="Bambu Lab", sku="B-XC011", location_id=L["bin_elec"])
item("USB-C Breakout Board", "electronic", 1, purchase_price=2.40, purchase_date=days_ago(18),
     vendor="DigiKey", location_id=L["bin_elec"], min_quantity=3)

item("Hardened Steel Nozzle 0.4mm - X1 Series", "printer_accessory", 2, purchase_price=19.99,
     purchase_date=days_ago(100), sku="FAH004", location_id=L["desk_drawer"], **bambu)
item("Textured PEI Plate", "printer_accessory", 1, purchase_price=29.99,
     purchase_date=days_ago(180), location_id=L["shelf3"], **bambu)
item("AMS Lite PTFE Tube Kit", "printer_accessory", 1, purchase_price=6.99,
     purchase_date=days_ago(240), location_id=L["shelf3"], **bambu)

item("Gorilla Super Glue Gel", "adhesive", 2, purchase_price=5.47, purchase_date=days_ago(20),
     vendor="Home Depot", brand="Gorilla", location_id=L["bin_adhesive"], min_quantity=2)
item("Kapton Tape 20mm", "adhesive", 1, unit="rolls", purchase_price=7.99,
     purchase_date=days_ago(140), vendor="Amazon", location_id=L["bin_adhesive"])
item("Glue Stick (PVP)", "adhesive", 0, purchase_price=3.99, purchase_date=days_ago(280),
     vendor="Amazon", location_id=L["bin_adhesive"], min_quantity=1)

item("Oracal 651 Vinyl Black 12in", "paper", 4, unit="sheets", purchase_price=1.25,
     purchase_date=days_ago(58), vendor="Amazon", location_id=L["layer3"])
item("Printable Sticker Paper A4", "paper", 22, unit="sheets", pack_quantity=50, purchase_price=18.99,
     purchase_date=days_ago(58), vendor="Amazon", location_id=L["layer3"])

item("Acrylic Paint Set 24 Colors", "craft_supply", 1, unit="sets", purchase_price=14.99,
     purchase_date=days_ago(190), vendor="Michaels", location_id=L["layer2"])

calipers = item("Digital Calipers 150mm", "tool", 1, purchase_price=24.99, purchase_date=days_ago(330),
                vendor="Amazon", brand="Mitutoyo", location_id=L["toolbox"],
                tool={"tool_type": "Measuring", "serial_number": "MT-50061"},
                tags=["measuring", "precision"])
item("Hex Key Set Metric", "tool", 1, unit="sets", purchase_price=16.49, purchase_date=days_ago(330),
     vendor="Amazon", brand="Wera", location_id=L["toolbox"], tool={"tool_type": "Hand tool"})
item("Soldering Iron TS101", "tool", 1, purchase_price=69.00, purchase_date=days_ago(120),
     vendor="Amazon", brand="Miniware", location_id=L["toolbox"], tool={"tool_type": "Electronics"})
item("Deburring Tool", "tool", 1, purchase_price=8.99, purchase_date=days_ago(16),
     vendor="Amazon", location_id=L["toolbox"], tool={"tool_type": "Hand tool"})

# A deliberate near-duplicate so the Duplicate Finder has something to show
item("M3x8 BHCS Machine Screw", "screws", 40, pack_quantity=100, purchase_price=5.99,
     purchase_date=days_ago(290), vendor="Amazon", location_id=L["bin_screws"])

# --- Printers + AMS ----------------------------------------------------------

x1c = call("POST", "printers.php", {
    "name": "X1 Carbon", "model": "Bambu Lab X1C",
    "slots": [{"ams_type": "ams2Pro", "ams_unit_number": 1, "slot_number": n} for n in range(1, 5)]
           + [{"ams_type": "externalManual", "ams_unit_number": 1, "slot_number": 1, "name": "External"}],
})
a1 = call("POST", "printers.php", {
    "name": "A1 Mini", "model": "Bambu Lab A1 mini",
    "slots": [{"ams_type": "amsLite", "ams_unit_number": 1, "slot_number": n} for n in range(1, 5)],
})
for slot, key in zip(x1c["slots"], ["pla_black", "pla_white", "petg", "matte_blue"]):
    call("PUT", f"printers.php?slot={slot['id']}&action=load", {"filament_item_id": F[key]["id"]})
for slot, key in zip(a1["slots"], ["pla_red", "galaxy"]):
    call("PUT", f"printers.php?slot={slot['id']}&action=load", {"filament_item_id": F[key]["id"]})

# --- Label templates ---------------------------------------------------------

with open(sys.argv[2] if len(sys.argv) > 2 else "web/assets/starter_templates.json") as fh:
    for tpl in json.load(fh):
        call("POST", "labels.php", tpl)

# --- Some history ------------------------------------------------------------

for it in random.sample(ITEMS, 8):
    if it["quantity"] > 2:
        call("PUT", f"items.php?id={it['id']}", {"quantity": it["quantity"] - random.randint(1, 2)})
call("PUT", f"items.php?id={calipers['id']}",
     {"tool": {"checked_out": True, "checked_out_at": days_ago(1) + " 15:20:00"}})

print(f"seeded {len(ITEMS)} items, {len(L)} locations, 2 printers")
