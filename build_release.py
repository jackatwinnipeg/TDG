from pathlib import Path
import shutil
r=Path(__file__).resolve().parent
out=r/"release"
if out.exists(): shutil.rmtree(out)
out.mkdir()
for name in ['index.html', 'login.html', 'change_password.html', 'admin.html', 'Current_Detail.html', 'History_Record.html', 'history_detail.html', 'tdg_print.html', 'batch_tdg_print.html', 'fill_log.html', 'batch_fill_log.html', 'export_tdg_print_optimized.html', 'favicon.ico', 'manifest.webmanifest']:
 shutil.copy2(r/name,out/name)
for name in ["js","css","assets"]:
 shutil.copytree(r/name,out/name)
print("Static release generated")
