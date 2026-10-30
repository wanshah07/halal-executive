import unittest
from unittest.mock import patch
import drive_organiser as organiser
class TestInboxCertificateFallback(unittest.TestCase):
 def test_unreadable_certificate_is_not_left_in_admin_queue(self):
  doc={'id':'DOC-0032','status':'inbox','kind':'certificate','category':'halal','title':'Sijil Pengesahan Halal Malaysia','drive_file_id':'file','notes':'','received_at':'2026-10-30'}
  written=[]
  def upsert(tab,rows):
   written.append((tab,rows))
   if tab=='Documents':
    assert rows[0]['status']=='current', 'certificate must leave inbox even when unreadable'
  with patch.object(organiser.he_api,'read',side_effect=lambda tab:[doc] if tab=='Documents' else [{'id':'CERT-0001','issuer':''}]), patch.object(organiser.he_api,'drive_get',return_value={'name':'scan.pdf','text':'','sha256':'newhash','modified':'now'}), patch.object(organiser.he_api,'drive_file',return_value={'url':'url','modified':'now','name':'scan.pdf'}), patch.object(organiser.llm_router,'complete_json',return_value={'provider':'test','model':'test','json':{'relation':'new','title':'Sijil Pengesahan Halal Malaysia','certificate':None}}), patch.object(organiser,'read_cert',return_value=(None,'','')), patch.object(organiser,'read_cert_image',return_value=(None,'','')), patch.object(organiser.he_api,'upsert',side_effect=upsert):
   organiser.run()
  assert any(tab=='Certificates' for tab,rows in written), 'certificate card must be created even if its holder is unreadable'
if __name__=='__main__':unittest.main()
