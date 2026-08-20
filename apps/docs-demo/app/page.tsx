import Link from "next/link";
import { PageContext } from "./page-context";

export const dynamic = "force-dynamic";

const DEMOS = [
  {
    title: "Docs assistant",
    href: "/docs/quickstart",
    port: "this app",
    blurb:
      "A documentation site that answers questions about itself. Every answer names the page it came from and offers to open it.",
    try: "Ask “how do permissions work?”",
  },
  {
    title: "Northwind Labs",
    href: "http://localhost:3001",
    port: "localhost:3001",
    blurb:
      "A SaaS dashboard: account context, billing reads, navigation, confirmed writes, and an admin-only capability.",
    try: "Ask “rename this project to EarthWatch”",
  },
  {
    title: "Tremor",
    href: "http://localhost:3002",
    port: "localhost:3002",
    blurb:
      "A hazard app where the model may never state a warning of its own. Official status comes from the agency feed or not at all.",
    try: "Ask “is there an official tsunami warning?”",
  },
  {
    title: "Playground",
    href: "http://localhost:3000",
    port: "localhost:3000",
    blurb:
      "The smallest integration: one context value, one read, one navigation, one confirmed write. Also the on-device model toggle.",
    try: "Tick “run the reasoning loop on-device”",
  },
];

export default function Home() {
  return (
    <>
      <PageContext id="home" />
      <section className="hero">
        <h1>Operable through language.</h1>
        <p>
          A runtime that lets an existing web application be driven by conversation — without the
          model ever owning product truth or authorization.
        </p>
        <p>
          Everything below runs with no API key and no model download. A deterministic provider
          handles routing and extraction; answers come from each app&rsquo;s own documentation and
          data.
        </p>
        <div className="prompts">
          <span className="prompt">context, not DOM scraping</span>
          <span className="prompt">deterministic permissions</span>
          <span className="prompt">confirmations, not “yes”</span>
          <span className="prompt">grounded or it refuses</span>
        </div>
      </section>

      <section className="demos">
        {DEMOS.map((demo) => (
          <Link className="demo" key={demo.title} href={demo.href}>
            <h3>{demo.title}</h3>
            <p>{demo.blurb}</p>
            <div className="try">{demo.try}</div>
            <div className="port">{demo.port}</div>
          </Link>
        ))}
      </section>
    </>
  );
}
