"""Pure cron replacement tests: no server or crontab mutations."""
import importlib.util,pathlib,unittest
spec=importlib.util.spec_from_file_location('schedule',pathlib.Path(__file__).with_name('install-check-schedule.py'))
schedule=importlib.util.module_from_spec(spec);spec.loader.exec_module(schedule)
PRICAT='12,42 * * * * /home/shopadmin/elektrikamarket-pricat/run-scheduled.sh publish >> /home/shopadmin/elektrikamarket-pricat/scheduler.log 2>&1\n'
OLD=PRICAT+'# BEGIN '+schedule.LEGACY+'\n0 23 * * * /home/shopadmin/elektrikamarket-prodat/run.sh check >> /home/shopadmin/elektrikamarket-prodat/scheduler.log 2>&1\n# END '+schedule.LEGACY+'\n'
class ScheduleTests(unittest.TestCase):
 def test_publish_replaces_one_job_preserving_pricat(self):
  result=schedule.replace_schedule(OLD,'publish')
  self.assertEqual(schedule.pricat_lines(result),schedule.pricat_lines(OLD))
  self.assertEqual(result.count('/elektrikamarket-prodat/run.sh publish'),1)
  self.assertNotIn('/elektrikamarket-prodat/run.sh check',result)
  self.assertEqual(schedule.replace_schedule(result,'publish'),result)
 def test_check_is_idempotent(self):
  result=schedule.replace_schedule(OLD,'check');self.assertEqual(schedule.replace_schedule(result,'check'),result)
 def test_duplicate_jobs_rejected(self):
  with self.assertRaises(AssertionError):schedule.replace_schedule(OLD+OLD,'publish')
 def test_unmanaged_job_rejected(self):
  with self.assertRaises(AssertionError):schedule.replace_schedule(OLD+'0 1 * * * /home/shopadmin/elektrikamarket-prodat/run.sh check\n','publish')
 def test_missing_managed_block_rejected(self):
  with self.assertRaises(AssertionError):schedule.replace_schedule(PRICAT,'publish')
 def test_first_check_installation_still_supported(self):
  result=schedule.replace_schedule(PRICAT,'check')
  self.assertEqual(result.count('/elektrikamarket-prodat/run.sh check'),1)
  self.assertEqual(schedule.pricat_lines(result),schedule.pricat_lines(PRICAT))
 def test_unknown_managed_command_rejected(self):
  with self.assertRaises(AssertionError):schedule.replace_schedule(OLD.replace('run.sh check','run.sh status'),'publish')
if __name__=='__main__':unittest.main()
