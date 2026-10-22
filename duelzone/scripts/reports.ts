import { Database } from "../server/db";
import { z } from "zod";

const [action = "list", reportId] = process.argv.slice(2);
if (!process.env.DATABASE_URL)
  throw Error("Set DATABASE_URL in a private owner terminal.");
if (!["list", "show", "resolve"].includes(action))
  throw Error("Use list, show <report-id>, or resolve <report-id>.");
if (action !== "list") z.string().uuid().parse(reportId);
const db = new Database();
try {
  if (action === "list") {
    console.table(
      (
        await db.query(
          "SELECT id,reason,created_at FROM player_reports WHERE status='open' ORDER BY created_at LIMIT 100",
        )
      ).rows,
    );
  } else if (action === "show") {
    console.dir(
      (
        await db.query(
          "SELECT r.*,a.username AS reporter,b.username AS target,m.body AS reported_message FROM player_reports r JOIN users a ON a.id=r.reporter_id JOIN users b ON b.id=r.target_id LEFT JOIN private_messages m ON m.id=r.message_id WHERE r.id=$1",
          [reportId],
        )
      ).rows,
      { depth: null },
    );
  } else {
    const result = await db.query(
      "UPDATE player_reports SET status='resolved' WHERE id=$1 AND status='open' RETURNING id",
      [reportId],
    );
    console.log(
      result.rows.length
        ? "Report marked reviewed. No account action was taken."
        : "No open report with that ID.",
    );
  }
} finally {
  await db.close();
}
