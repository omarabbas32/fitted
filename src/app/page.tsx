import { Dashboard } from "@/components/Dashboard";
import { listCvs } from "@/app/actions/cv";
import { listVersions } from "@/app/actions/version";
import { getSettingsView } from "@/app/actions/settings";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [cvs, versions, settings] = await Promise.all([
    listCvs(),
    listVersions(),
    getSettingsView(),
  ]);

  return (
    <Dashboard
      initialCvs={cvs}
      initialVersions={versions}
      initialSettings={settings}
    />
  );
}
