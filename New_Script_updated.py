import requests
import pandas as pd
from PIL import Image, ImageDraw, ImageFont

API_KEY = "HXllpxwbKLz5oGdf"

# ----------------------------
# Colours
# ----------------------------

BACKGROUND = (30, 30, 30)
ROW_BG = (45, 45, 45)
TEXT = (235, 235, 235)
HEADER = (70, 70, 70)

STATUS_COLOURS = {
    "green": (46, 204, 113),
    "red": (231, 76, 60),
    "blue": (52, 152, 219),
    "orange": (243, 156, 18),
    "yellow": (241, 196, 15)
}


# ----------------------------
# API
# ----------------------------

def get_faction_id(faction_name):
    url = f"https://api.torn.com/v2/faction/search?name={faction_name}"

    response = requests.get(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": f"ApiKey {API_KEY}"
        }
    )

    response.raise_for_status()

    return response.json()["search"][0]["id"]


def get_faction_members(faction_id):
    url = f"https://api.torn.com/v2/faction/{faction_id}/members"

    response = requests.get(
        url,
        headers={
            "Accept": "application/json",
            "Authorization": f"ApiKey {API_KEY}"
        }
    )

    response.raise_for_status()

    return response.json()["members"]


# ----------------------------
# Image Creator
# ----------------------------

def create_member_image(members, filename="members.png"):
    rows = []

    for member in members:
        status = member["status"]

        rows.append({
            "Name": member["name"],
            "Level": member["level"],
            "Position": member["position"],
            "Status": status["description"],
            "Last Action": member["last_action"]["relative"],
            "Colour": status["color"],
            "Revivable": "✔" if member["is_revivable"] else ""
        })

    df = pd.DataFrame(rows)

    # ------------------------
    # Image sizing
    # ------------------------

    width = 1300
    row_height = 34
    header_height = 40
    height = header_height + len(df) * row_height + 20

    image = Image.new("RGB", (width, height), BACKGROUND)
    draw = ImageDraw.Draw(image)

    try:
        font = ImageFont.truetype("consola.ttf", 18)
        bold = ImageFont.truetype("consolab.ttf", 18)
    except:
        font = ImageFont.load_default()
        bold = ImageFont.load_default()

    def draw_cell_text(text, x1, x2, y, fill, font_obj, align="left"):
        text = str(text)
        bbox = draw.textbbox((0, 0), text, font=font_obj)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]

        if align == "center":
            x = x1 + ((x2 - x1) - text_w) / 2
        elif align == "right":
            x = x2 - text_w - 10
        else:
            x = x1 + 10

        y_text = y + (row_height - text_h) / 2 - 1
        draw.text((x, y_text), text, fill=fill, font=font_obj)

    # ------------------------
    # Column layout
    # ------------------------

    columns = [
        ("Name", 20, 220),
        ("Lvl", 220, 280),
        ("Position", 300, 500),
        ("Status", 520, 900),
        ("Revive", 900, 980),
        ("Last Action", 1000, 1280)
    ]

    # Header background
    draw.rectangle((0, 0, width, header_height), fill=HEADER)

    # Header text
    for text, x1, x2 in columns:
        draw_cell_text(text, x1, x2, 0, "white", bold, align="left")

    # Optional vertical separators
    for _, x1, x2 in columns:
        draw.line((x2, 0, x2, height), fill=(90, 90, 90), width=1)

    # ------------------------
    # Rows
    # ------------------------

    y = header_height

    for _, row in df.iterrows():
        draw.rounded_rectangle(
            (8, y + 2, width - 8, y + row_height - 2),
            radius=6,
            fill=ROW_BG
        )

        draw_cell_text(row["Name"], 20, 220, y, TEXT, font, align="left")
        draw_cell_text(row["Level"], 220, 280, y, TEXT, font, align="left")
        draw_cell_text(row["Position"], 300, 500, y, TEXT, font, align="left")

        colour = STATUS_COLOURS.get(row["Colour"], (255, 255, 255))
        draw_cell_text(row["Status"], 520, 900, y, colour, font, align="left")

        if row["Revivable"]:
            draw_cell_text(row["Revivable"], 900, 980, y, (46, 204, 113), font, align="center")

        draw_cell_text(row["Last Action"], 1000, 1280, y, TEXT, font, align="left")

        y += row_height

    image.save(filename)
    print(f"Saved {filename}")


# ----------------------------
# Main
# ----------------------------

if __name__ == "__main__":
    faction_id = get_faction_id("Warband of the Fallen")
    members = get_faction_members(faction_id)
    create_member_image(members)