import { formatMoney, getAccount, listInvoices } from "@/lib/data";
import { PageContext } from "../../page-context";

// The demo mutates data in memory, so pages must not be prerendered.
export const dynamic = "force-dynamic";

export default function Billing() {
  const account = getAccount();
  const invoices = listInvoices();
  return (
    <>
      <PageContext id="settings.billing" />
      <h1>Billing</h1>
      <p className="sub">
        {account.plan} plan · {account.seats} seats · renews {account.renewsAt}
      </p>

      <div className="card">
        <div className="row">
          <span>Payment method</span>
          <span className="muted">{account.paymentMethod}</span>
        </div>
      </div>

      <h2>Invoices</h2>
      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Date</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id} id={invoice.number}>
              <td>
                <code>{invoice.number}</code>
              </td>
              <td className="muted">{invoice.issuedAt}</td>
              <td>{formatMoney(invoice.amountCents)}</td>
              <td className="muted">{invoice.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
