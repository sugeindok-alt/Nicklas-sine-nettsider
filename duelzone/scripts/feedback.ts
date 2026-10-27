import { Database } from "../server/db";
import { z } from "zod";
const [action = "list", id] = process.argv.slice(2);
if (!process.env.DATABASE_URL)
  throw Error("Set DATABASE_URL in a private owner terminal.");
if (!["list", "show", "resolve"].includes(action))
  throw Error("Use list, show <id> or resolve <id>.");
if (action !== "list") z.string().uuid().parse(id);
const db = new Database();
try {
  if (action === "list")
    console.table(
      (
        await db.query(
          "SELECT id,kind,game,rating,created_at FROM feedback WHERE status='open' ORDER BY created_at LIMIT 100",
        )
      ).rows,
    );
  else if (action === "show")
    console.dir(
      (
        await db.query(
          "SELECT f.*,u.username FROM feedback f JOIN users u ON u.id=f.user_id WHERE f.id=$1",
          [id],
        )
      ).rows,
      { depth: null },
    );
  else
    console.log(
      (
        await db.query(
          "UPDATE feedback SET status='reviewed' WHERE id=$1 AND status='open' RETURNING id",
          [id],
        )
      ).rows.length
        ? "Feedback marked reviewed."
        : "No open feedback with this ID.",
    );
} finally {
  await db.close();
}
