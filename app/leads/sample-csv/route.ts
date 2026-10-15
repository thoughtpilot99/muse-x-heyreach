// Template for the lead CSV import. "about" is the profile text Muse Wonder writes from.
const SAMPLE = [
  "profileUrl,firstName,lastName,company,position,about",
  '"https://www.linkedin.com/in/example-person","Ana","Silva","Acme Analytics","Head of Marketing","Leads a 6-person team; recently posted about moving budget from paid social to partnerships."',
  '"https://www.linkedin.com/in/another-example","Tom","Becker","Northwind Logistics","VP Sales","Hiring 3 SDRs in Berlin; speaks about outbound in the logistics vertical."',
].join("\r\n");

export function GET() {
  return new Response(SAMPLE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="reachguard-leads-template.csv"',
    },
  });
}
