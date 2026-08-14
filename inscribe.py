#!/usr/bin/env python3
"""
Inscribe jennie21 Lean proofs as Bitcoin Ordinals via OrdinalsBot API.
No Bitcoin node required.

Usage:
    python3 inscribe.py <your_btc_receive_address> [--fee-rate N]

Cost estimate: ~3000–6000 sats per file at 12 sat/vbyte.
"""

import argparse
import base64
import json
import sys
import time
from pathlib import Path

import urllib.request
import urllib.error

INSCRIBE_URL = "https://api.ordinalsbot.com/inscribe"
ORDER_URL    = "https://api.ordinalsbot.com/order"
HEADERS      = {"Accept": "application/json", "Content-Type": "application/json"}

PROOF_FILES = [
    Path(__file__).parent / "research" / "orbit_proof.lean",
    Path(__file__).parent / "research" / "primitive_root_proof.lean",
    Path(__file__).parent / "research" / "ideal_proof.lean",
]


def http(method, url, payload=None):
    data = json.dumps(payload).encode() if payload else None
    req = urllib.request.Request(url, data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        sys.exit(f"HTTP {e.code} from {url}: {body}")


def poll_charge(order_id, retries=10, delay=3):
    """Poll /order until charge.address appears."""
    for i in range(retries):
        result = http("GET", f"{ORDER_URL}?id={order_id}")
        charge = result.get("charge", {})
        if charge.get("address"):
            return charge
        if i < retries - 1:
            print(f"    waiting for charge address ({i+1}/{retries})...", flush=True)
            time.sleep(delay)
    return None


def inscribe_file(path, receive_address, fee_rate):
    content = path.read_bytes()
    # OrdinalsBot only accepts specific extensions; .lean → .txt (content unchanged)
    name = path.stem + ".txt"
    data_url = "data:plain/text;base64," + base64.b64encode(content).decode()

    payload = {
        "files": [{
            "name": name,
            "size": len(content),
            "type": "plain/text",
            "dataURL": data_url,
        }],
        "fee": fee_rate,
        "receiveAddress": receive_address,
    }

    print(f"\n  Submitting {path.name} → {name} ({len(content)} bytes)...")
    result = http("POST", INSCRIBE_URL, payload)

    if result.get("status") != "ok":
        print(f"  API error: {json.dumps(result, indent=2)}")
        return None

    order_id = result["id"]
    print(f"  Order ID:  {order_id}")

    charge = poll_charge(order_id)
    if not charge:
        print(f"  Warning: charge address not ready yet — check https://ordinalsbot.com/order/{order_id}")
        return {"id": order_id, "amount": result.get("charge", {}).get("amount")}

    print(f"  Pay to:    {charge['address']}")
    print(f"  Amount:    {charge['amount']} sats")
    charge["id"] = order_id
    return charge


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("receive_address", help="Bitcoin address to receive inscriptions")
    parser.add_argument("--fee-rate", type=int, default=12, metavar="N", help="sat/vbyte (default: 12)")
    parser.add_argument("--dry-run", action="store_true", help="Print payloads without sending")
    args = parser.parse_args()

    print(f"jennie21 Ordinals inscription")
    print(f"  Receive address: {args.receive_address}")
    print(f"  Fee rate:        {args.fee_rate} sat/vbyte")

    if args.dry_run:
        for path in PROOF_FILES:
            print(f"\n  [dry-run] {path.name} → {path.stem}.txt ({path.stat().st_size} bytes)")
        return

    charges = []
    for i, path in enumerate(PROOF_FILES):
        if i > 0:
            # Rate limit: max 2 requests per 10 seconds
            time.sleep(6)
        charge = inscribe_file(path, args.receive_address, args.fee_rate)
        if charge:
            charges.append((path.name, charge))

    if not charges:
        sys.exit("No orders created.")

    print(f"\n{'='*60}")
    print(f"  {len(charges)} order(s) created.")
    print(f"{'='*60}")
    for name, charge in charges:
        addr = charge.get("address", "(pending — check ordinalsbot.com)")
        print(f"\n  {name}")
        print(f"    Pay:   {charge.get('amount', '?')} sats → {addr}")
        print(f"    Track: https://ordinalsbot.com/order/{charge['id']}")

    print(f"\n  Inscriptions land at ord.io once confirmed (~10–60 min).")

    out_path = Path(__file__).parent / "tags" / "inscriptions.json"
    out_path.write_text(json.dumps({name: charge for name, charge in charges}, indent=2))
    print(f"  Saved to {out_path}")


if __name__ == "__main__":
    main()
