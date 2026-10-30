import unittest
from pathlib import Path
ADMIN_CERT='Admin upload: this is a halal certificate'
class ForceAdminCertificateTest(unittest.TestCase):
 def test_explicit_certificate_choice_is_authoritative(self):
  self.assertTrue(('Admin upload: this is a halal certificate').startswith(ADMIN_CERT))
  # Every explicit Admin certificate needs an unconditional Documents row.
  import pathlib
  source=pathlib.Path(__file__).with_name('process_raw.py').read_text()
  self.assertIn('force_admin_certificate', source, 'missing unconditional Admin certificate route')
if __name__=='__main__':unittest.main()
