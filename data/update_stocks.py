import json
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import requests


class StockDatasetUpdater:
    """
    JSON record shape (per entry):
      {
        "name": "Apple Inc.",
        "ticker": "AAPL",
        "industry": "Technology Hardware",
        "market_cap": "2.9T",
        "last_updated": "2025-10-03",  # MANUAL ONLY (or via set_target_price)
        "current_price": "227.15",
        "target_price": "250",
        "page": "stocks/AAPL.html"
      }

    Policy:
      - `update_json()` (refresh ALL) and `upsert_ticker()` (refresh ONE) DO NOT change `last_updated`.
      - `set_target_price()` updates target price AND sets `last_updated` to today.
      - `set_last_updated()` lets you manually set (or clear) `last_updated`.
      - `set_industry()` lets you manually set/override industry (does NOT change `last_updated`).
      - `upsert_ticker()` will NOT overwrite a non-empty existing `industry`; it only fills if missing.
    """

    NASDAQ_API = "https://api.nasdaq.com/api/screener/stocks"
    DEFAULT_HEADERS = {
        "authority": "api.nasdaq.com",
        "user-agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "accept": "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "origin": "https://www.nasdaq.com",
        "referer": "https://www.nasdaq.com/",
    }

    def __init__(
        self,
        json_path: str,
        include_nyse: bool = True,
        include_nasdaq: bool = True,
        include_amex: bool = True,
        session: Optional[requests.Session] = None,
        logger: Optional[logging.Logger] = None,
    ):
        self.json_path = Path(json_path)
        self.include = {"nyse": include_nyse, "nasdaq": include_nasdaq, "amex": include_amex}
        self.session = session or requests.Session()
        self.session.headers.update(self.DEFAULT_HEADERS)

        self.logger = logger or logging.getLogger("StockDatasetUpdater")
        if not self.logger.handlers:
            logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    # ---------------- Public API ----------------

    def update_json(self) -> None:
        """Refresh ALL tickers; do NOT modify last_updated."""
        existing = self._load_existing()
        universe = self._fetch_universe()
        merged = self._merge_refresh_all(existing, universe)  # preserves last_updated
        merged = [self._ensure_rating_strategy(rec) for rec in merged]
        self._write_json(merged)
        self.logger.info("Wrote %d records to %s", len(merged), self.json_path)

    def _ensure_rating_strategy(self, rec: Dict) -> Dict:
        """Guarantee rating/strategy keys exist (empty string when missing/None)."""
        r = rec.copy()
        if r.get("rating") is None or "rating" not in r:
            r["rating"] = ""
        if r.get("strategy") is None or "strategy" not in r:
            r["strategy"] = ""
        return r

    def upsert_ticker(self, ticker: str, *, target_price: Optional[str] = None,
                      strategy: Optional[str] = None, rating: Optional[str] = None) -> None:
        """
        Add/update ONE ticker from screener; do NOT modify last_updated.
        - target_price/strategy/rating are replaced only if provided (else preserved).
        - existing non-empty fields are preserved (as before).
        """
        ticker = ticker.strip().upper()
        existing = self._load_existing()
        ex_by_ticker = {(e.get("ticker") or "").upper(): e for e in existing}

        fresh = self._fetch_single_from_screener(ticker)
        if not fresh:
            self.logger.warning("Ticker %s not found in screener; creating/keeping placeholder.", ticker)
            fresh = {
                "name": ex_by_ticker.get(ticker, {}).get("name", ""),
                "ticker": ticker,
                "industry": ex_by_ticker.get(ticker, {}).get("industry", ""),
                "market_cap": ex_by_ticker.get(ticker, {}).get("market_cap", ""),
                "current_price": ex_by_ticker.get(ticker, {}).get("current_price", ""),
                "page": f"stocks/{ticker}.html",
            }

        prev = ex_by_ticker.get(ticker, {})
        prev_ind = (prev.get("industry") or "").strip()
        industry = prev_ind if prev_ind else (fresh.get("industry") or "")

        merged = {
            "name": fresh["name"],
            "ticker": ticker,
            "industry": industry,
            "market_cap": fresh["market_cap"],
            "last_updated": prev.get("last_updated", ""),
            "current_price": fresh["current_price"],
            "target_price": str(target_price) if target_price is not None else prev.get("target_price", ""),
            "strategy":     str(strategy)     if strategy     is not None else prev.get("strategy", ""),
            "rating":       str(rating)       if rating       is not None else prev.get("rating", ""),
            "page": f"stocks/{ticker}.html",
        }

        ex_by_ticker[ticker] = merged
        out = [self._ensure_rating_strategy(ex_by_ticker[t]) for t in sorted(ex_by_ticker.keys())]
        self._write_json(out)
        self.logger.info("Upserted %s (last_updated unchanged) -> %s", ticker, self.json_path)

    def set_target_price(self, ticker: str, target_price: str) -> None:
        """
        Update ONLY the target price of a ticker and bump last_updated (today).
        """
        ticker = ticker.strip().upper()
        data = self._load_existing()
        by_ticker = {(e.get("ticker") or "").upper(): e for e in data}

        rec = by_ticker.get(ticker)
        if not rec:
            # create a minimal stub
            rec = {
                "name": "",
                "ticker": ticker,
                "industry": "",
                "market_cap": "",
                "last_updated": self._today(),  # set because we're changing target
                "current_price": "",
                "target_price": str(target_price),
                "page": f"stocks/{ticker}.html",
            }
        else:
            rec = rec.copy()
            rec["target_price"] = str(target_price)
            rec["last_updated"] = self._today()

        rec["page"] = f"stocks/{ticker}.html"
        by_ticker[ticker] = rec

        out = [by_ticker[t] for t in sorted(by_ticker.keys())]
        self._write_json(out)
        self.logger.info("Set target price for %s (last_updated set) -> %s", ticker, self.json_path)
        
    def set_strategy(self, ticker: str, strategy: str) -> None:
        """Update ONLY the strategy and bump last_updated (today)."""
        self._set_field_and_bump(ticker, field="strategy", value=str(strategy))  # NEW

    def set_rating(self, ticker: str, rating: str) -> None:
        """Set/override rating; does NOT change last_updated."""
        ticker = ticker.strip().upper()
        data = self._load_existing()
        by_ticker = {(e.get("ticker") or "").upper(): e for e in data}
        rec = by_ticker.get(ticker, {
            "name": "", "ticker": ticker, "industry": "", "market_cap": "",
            "last_updated": self._today(), "current_price": "", "target_price": "",
            "strategy": "", "rating": "", "page": f"stocks/{ticker}.html"
        }).copy()
        rec["rating"] = str(rating)
        rec["page"] = f"stocks/{ticker}.html"
        by_ticker[ticker] = rec
        out = [by_ticker[t] for t in sorted(by_ticker.keys())]
        self._write_json(out)
        self.logger.info("Set rating for %s -> %s", ticker, rating or "(empty)")

    def set_last_updated(self, ticker: str, date: Optional[str] = None) -> None:
        """
        Manually set (or clear) last_updated for a ticker.
        - date="" => sets to today
        - date="delete" => clears it
        - else must be 'YYYY-MM-DD'
        """
        ticker = ticker.strip().upper()
        data = self._load_existing()
        by_ticker = {(e.get("ticker") or "").upper(): e for e in data}

        rec = by_ticker.get(ticker, {
            "name": "",
            "ticker": ticker,
            "industry": "",
            "market_cap": "",
            "current_price": "",
            "target_price": "",
            "page": f"stocks/{ticker}.html",
        }).copy()

        if date == "":
            rec["last_updated"] = self._today()
        elif date == "delete":
            rec["last_updated"] = ""
        else:
            if date and not self._valid_date(date):
                raise ValueError("date must be YYYY-MM-DD, empty string to clear, or None for today")
            rec["last_updated"] = date

        rec["page"] = f"stocks/{ticker}.html"
        by_ticker[ticker] = rec

        out = [by_ticker[t] for t in sorted(by_ticker.keys())]
        self._write_json(out)
        self.logger.info("Set last_updated for %s -> %s", ticker, rec["last_updated"])

    def set_industry(self, ticker: str, industry: str) -> None:
        """
        Manually set/override the `industry` field for a ticker.
        Does NOT modify last_updated.
        """
        ticker = ticker.strip().upper()
        industry = (industry or "").strip()
        data = self._load_existing()
        by_ticker = {(e.get("ticker") or "").upper(): e for e in data}

        rec = by_ticker.get(ticker, {
            "name": "",
            "ticker": ticker,
            "industry": "",
            "market_cap": "",
            "last_updated": "",
            "current_price": "",
            "target_price": "",
            "page": f"stocks/{ticker}.html",
        }).copy()

        rec["industry"] = industry
        rec["page"] = f"stocks/{ticker}.html"
        by_ticker[ticker] = rec

        out = [by_ticker[t] for t in sorted(by_ticker.keys())]
        self._write_json(out)
        self.logger.info("Set industry for %s -> %s", ticker, industry or "(empty)")

    # ---------- internal helper ----------
    def _set_field_and_bump(self, ticker: str, *, field: str, value: str) -> None:
        """Set one field and bump last_updated to today (used by target_price & strategy)."""
        ticker = ticker.strip().upper()
        data = self._load_existing()
        by_ticker = {(e.get("ticker") or "").upper(): e for e in data}

        rec = by_ticker.get(ticker)
        if not rec:
            rec = {
                "name": "", "ticker": ticker, "industry": "", "market_cap": "",
                "last_updated": self._today(), "current_price": "",
                "target_price": "" if field != "target_price" else value,
                "strategy": ""     if field != "strategy"     else value,
                "rating": "",
                "page": f"stocks/{ticker}.html",
            }
        else:
            rec = rec.copy()
            rec[field] = value
            rec["last_updated"] = self._today()
            rec["page"] = f"stocks/{ticker}.html"

        by_ticker[ticker] = rec
        out = [by_ticker[t] for t in sorted(by_ticker.keys())]
        self._write_json(out)
        self.logger.info("Set %s for %s (last_updated set) -> %s", field, ticker, self.json_path)

    def _merge_refresh_all(self, existing: List[Dict], universe: Dict[str, Dict]) -> List[Dict]:
        """Full refresh (ALL): preserve last_updated, target_price, strategy, rating."""
        ex_by_t = {(e.get("ticker") or "").upper(): e for e in (existing or [])}
        updated: Dict[str, Dict] = {}
        for tkr, fresh in universe.items():
            prev = ex_by_t.get(tkr, {})
            merged = {
                "name": fresh["name"],
                "ticker": tkr,
                "industry": fresh["industry"],
                "market_cap": fresh["market_cap"],
                "last_updated": prev.get("last_updated", ""),
                "current_price": fresh["current_price"],
                "target_price": prev.get("target_price", ""),
                "strategy":     prev.get("strategy", ""),    # NEW
                "rating":       prev.get("rating", ""),      # NEW
                "page": f"stocks/{tkr}.html",
            }
            updated[tkr] = merged
        return [updated[t] for t in sorted(updated.keys())]
    
    # ---------------- Fetch helpers ----------------

    def _fetch_universe(self) -> Dict[str, Dict]:
        rows: List[Dict] = []
        for exch, use in self.include.items():
            if not use:
                continue
            r = self.session.get(self.NASDAQ_API, params={"download": "true", "exchange": exch}, timeout=30)
            r.raise_for_status()
            payload = r.json()
            rows.extend((payload or {}).get("data", {}).get("rows", []) or [])
        return self._normalize_rows(rows)

    def _fetch_single_from_screener(self, ticker: str) -> Optional[Dict]:
        ticker = ticker.upper()
        for exch, use in self.include.items():
            if not use:
                continue
            r = self.session.get(self.NASDAQ_API, params={"download": "true", "exchange": exch}, timeout=30)
            try:
                r.raise_for_status()
                payload = r.json()
            except Exception:
                continue
            rows = (payload or {}).get("data", {}).get("rows", []) or []
            for row in rows:
                if (row.get("symbol") or "").strip().upper() == ticker:
                    return self._normalize_row(row)
        return None

    # ---------------- Merge logic ----------------

    def _merge_refresh_all(self, existing: List[Dict], universe: Dict[str, Dict]) -> List[Dict]:
        """
        Full refresh (ALL): preserve last_updated & target_price.
        (Industry is refreshed from feed here; if you also want to preserve industry during full refresh,
         change the assignment below similar to upsert_ticker.)
        """
        ex_by_t = {(e.get("ticker") or "").upper(): e for e in (existing or [])}
        updated: Dict[str, Dict] = {}

        for tkr, fresh in universe.items():
            prev = ex_by_t.get(tkr, {})
            merged = {
                "name": fresh["name"],
                "ticker": tkr,
                "industry": fresh["industry"],   # <- full refresh uses feed value
                "market_cap": fresh["market_cap"],
                "last_updated": prev.get("last_updated", ""),  # preserved (manual)
                "current_price": fresh["current_price"],
                "target_price": prev.get("target_price", ""),
                "page": f"stocks/{tkr}.html",
            }
            updated[tkr] = merged

        return [updated[t] for t in sorted(updated.keys())]

    # ---------------- Normalization ----------------

    def _normalize_rows(self, rows: List[Dict]) -> Dict[str, Dict]:
        out: Dict[str, Dict] = {}
        for row in rows:
            norm = self._normalize_row(row)
            if norm:
                out[norm["ticker"]] = norm
        return out

    def _normalize_row(self, row: Dict) -> Optional[Dict]:
        ticker = (row.get("symbol") or "").strip().upper()
        if not ticker:
            return None
        name = (row.get("name") or "").strip()
        industry = (row.get("industry") or row.get("sector") or "").strip()

        market_cap_raw = (row.get("marketCap") or "").replace(",", "").strip()
        market_cap_val = self._safe_float(market_cap_raw)
        market_cap_pretty = self._fmt_market_cap(market_cap_val) if market_cap_val is not None else ""

        current_price = self._parse_price(row.get("lastsale", ""))

        return {
            "name": name,
            "ticker": ticker,
            "industry": industry,
            "market_cap": market_cap_pretty,
            "current_price": current_price,
            "page": f"stocks/{ticker}.html",
        }

    # ---------------- File I/O ----------------

    def _load_existing(self) -> List[Dict]:
        if not self.json_path.exists():
            self.logger.info("No existing file at %s (will create a new one).", self.json_path)
            return []
        with self.json_path.open("r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            raise ValueError(f"{self.json_path} must contain a JSON array.")

    def _write_json(self, records: List[Dict]) -> None:
        self.json_path.parent.mkdir(parents=True, exist_ok=True)
        with self.json_path.open("w", encoding="utf-8") as f:
            json.dump(records, f, indent=2, ensure_ascii=False)

    # ---------------- Utils ----------------

    @staticmethod
    def _today() -> str:
        return datetime.now().strftime("%Y-%m-%d")

    @staticmethod
    def _valid_date(s: str) -> bool:
        try:
            datetime.strptime(s, "%Y-%m-%d")
            return True
        except ValueError:
            return False

    @staticmethod
    def _safe_float(s: str) -> Optional[float]:
        if s is None:
            return None
        s = str(s).strip()
        if not s:
            return None
        try:
            return float(s)
        except ValueError:
            return None

    @staticmethod
    def _parse_price(s: str) -> str:
        if not s:
            return ""
        m = re.search(r"(\d+(?:\.\d+)?)", str(s))
        return m.group(1) if m else ""

    @staticmethod
    def _fmt_market_cap(v: Optional[float]) -> str:
        if v is None:
            return ""
        abs_v = abs(v)
        for unit, div in (("T", 1e12), ("B", 1e9), ("M", 1e6), ("K", 1e3)):
            if abs_v >= div:
                return f"{v / div:.2f}".rstrip("0").rstrip(".") + unit
        return f"{int(v)}"


# ---------------- CLI menu ----------------
def main():
    """
    Menu:
      [1] Refresh ALL stocks (does NOT change last_updated)
      [2] Add/Update a SINGLE ticker (does NOT change last_updated; preserves non-empty industry)
      [3] Set ONLY target price (updates last_updated to today)
      [4] Set/Update last_updated manually
      [5] Set/Update industry manually (does NOT change last_updated)
      [6] Exit
    """
    json_path = "data/stocks.json"
    updater = StockDatasetUpdater(json_path=json_path, include_nyse=True, include_nasdaq=True, include_amex=True)

    while True:
        print("\nStock Dataset Updater")
        print("=====================")
        print("[1] Refresh ALL stocks (no change to last_updated)")
        print("[2] Add/Update SINGLE ticker (no change to last_updated; preserves non-fresh fields if present)")
        print("[3] Set ONLY target price (updates last_updated to today)")
        print("[4] Set/Update last_updated manually")
        print("[5] Set/Update industry manually (no change to last_updated)")
        print("[6] Set/Update strategy (updates last_updated to today)")
        print("[7] Set/Update rating (updates last_updated to today)")
        print("[8] Exit")
        choice = input("Select an option [1/2/3/4/5/6/7/8]: ").strip()

        if choice == "1":
            updater.update_json()

        elif choice == "2":
            tkr = input("Enter ticker (e.g., AAPL): ").strip().upper()
            replace_tp = input("Update target_price here? (does NOT change last_updated) [y/N]: ").strip().lower() == "y"
            if replace_tp:
                tp = input("Enter target price (e.g., 250): ").strip()
                updater.upsert_ticker(tkr, target_price=tp)
            else:
                updater.upsert_ticker(tkr)

        elif choice == "3":
            tkr = input("Enter ticker (e.g., AAPL): ").strip().upper()
            tp = input("Enter target price (e.g., 250): ").strip()
            updater.set_target_price(tkr, tp)

        elif choice == "4":
            tkr = input("Enter ticker (e.g., AAPL): ").strip().upper()
            val = input("Enter date YYYY-MM-DD, enter \"delete\" to clear, or press Enter for today: ").strip()
            if val == "":
                updater.set_last_updated(tkr, date="")
            else:
                updater.set_last_updated(tkr, date=None if val == "" else val)

        elif choice == "5":
            tkr = input("Enter ticker (e.g., AAPL): ").strip().upper()
            ind = input("Enter industry (leave empty to clear): ").strip()
            updater.set_industry(tkr, ind)

        elif choice == "6":
            tkr = input("Ticker: ").strip().upper()
            val = input("Strategy (e.g., Swing, LT, Momentum): ").strip()
            updater.set_strategy(tkr, val)

        elif choice == "7":
            tkr = input("Ticker: ").strip().upper()
            val = input("Rating (e.g., Buy, Hold, Sell, A/B/C): ").strip()
            updater.set_rating(tkr, val)

        elif choice == "8":
            print("Exiting.")
            return

        else:
            print("No action selected.")


if __name__ == "__main__":
    main()
