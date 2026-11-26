import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Boxes, FileClock, Package, TriangleAlert } from "lucide-react";
import { api } from "../services/api";
import { useSession } from "../features/auth/AuthGuard";
import { EmptyState, PageHeading, Panel } from "../components/ui";

type Summary = { totalInventoryValue: string; trackedItemLocations: number; lowStock: number; outOfStock: number };
type ItemList = { rows?: Array<{ id: string }>; total?: number };
type DocumentList = { documents?: Array<{ id: string; documentNumber: string; type: string; status: string; effectiveDate: string }> };

export function Dashboard() {
  const session=useSession();const company=session.data?.companies.find(c=>c.id===session.data?.activeCompanyId);const canReport=company?.permissions.includes("inventory.reports.view");const canView=company?.permissions.includes("inventory.view");
  const summary=useQuery({queryKey:["inventory","summary"],queryFn:()=>api<Summary>("/inventory/summary"),enabled:!!canReport});
  const items=useQuery({queryKey:["inventory","items","dashboard"],queryFn:()=>api<ItemList>("/items?page=1&pageSize=1"),enabled:!!company?.permissions.includes("items.view")});
  const documents=useQuery({queryKey:["inventory","stock-documents","dashboard"],queryFn:()=>api<DocumentList>("/stock-documents?page=1&pageSize=5"),enabled:!!canView});
  const metrics=[{label:"Inventory valuation",value:summary.data?`₹${summary.data.totalInventoryValue}`:"—",note:"GST exclusive, at moving average",icon:Boxes},{label:"Stock locations",value:summary.data?.trackedItemLocations??"—",note:"Active balance projection rows",icon:Package},{label:"Low stock",value:summary.data?.lowStock??"—",note:`${summary.data?.outOfStock??0} out of stock`,icon:TriangleAlert},{label:"Items",value:items.data?.total??"—",note:"Company item master",icon:Package}];
  return <><PageHeading eyebrow="BUSINESS OVERVIEW" title="Inventory Overview" description="Current stock health and recent stock documents for the active company."/><div className="metrics-grid">{metrics.map(metric=><article className="metric-card" key={metric.label}><div className="metric-top"><span>{metric.label}</span><div className="metric-icon blue"><metric.icon size={18}/></div></div><div className="metric-value">{metric.value}</div><div className="metric-note">{metric.note}</div></article>)}</div>{summary.isError&&<div className="form-error">{summary.error.message}</div>}<div className="dashboard-grid"><Panel><div className="panel-heading"><div><h2>Recent stock documents</h2><p>Latest receipts, issues, transfers, adjustments and reversals</p></div><FileClock size={18}/></div>{documents.isLoading?<div className="loading-box">Loading…</div>:!documents.data?.documents?.length?<EmptyState title="No stock documents yet" description="Create an opening stock document to begin recording inventory."/>:<div className="responsive-table-wrap"><table className="erp-table"><thead><tr><th>Document</th><th>Type</th><th>Status</th><th>Date</th></tr></thead><tbody>{documents.data.documents.map(doc=><tr key={doc.id}><td>{doc.documentNumber}</td><td>{doc.type}</td><td>{doc.status}</td><td>{doc.effectiveDate.slice(0,10)}</td></tr>)}</tbody></table></div>}</Panel><Panel><div className="panel-heading"><div><h2>Inventory shortcuts</h2><p>Company scoped tools</p></div><ArrowRight size={18}/></div><div className="simple-empty"><Link to="/inventory/stock-balances">Stock balances</Link></div><div className="simple-empty"><Link to="/inventory/stock-ledger">Stock ledger</Link></div><div className="simple-empty"><Link to="/inventory/reconciliation">Reconciliation</Link></div><div className="simple-empty"><Link to="/reports">Inventory reports</Link></div></Panel></div></>;
}
