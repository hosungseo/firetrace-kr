"""Regression tests for incident isolation, geometry, time alignment and HTTP cache."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timedelta

import incident
from derive import clusters, select_cluster, acquired, incident_rows, align
from fetch_population import historical_code, items


class IncidentTests(unittest.TestCase):
    def test_time_origin_and_display_cap(self):
        for seed in incident.seeds():
            base=incident.t0(seed)
            self.assertEqual((datetime.fromisoformat(seed['start']).date()-base.date()).days,1)
            self.assertEqual(base.utcoffset(),timedelta(hours=9))
            self.assertTrue(3<=incident.display_days(seed)<=10)
            self.assertEqual(incident.hours(seed)[-1],(incident.display_days(seed)+1)*1440)
        self.assertEqual(incident.t0(incident.load()).isoformat(),'2025-03-21T00:00:00+09:00')
        self.assertEqual(incident.display_days(incident.load('sancheong-2025')),10)

    def test_area_weighted_centroid_ignores_vertex_density(self):
        ring=[[0,0],[1,0],[2,0],[4,0],[4,2],[0,2],[0,0]]
        self.assertEqual(incident.centroid({'type':'Polygon','coordinates':[ring]}),[2,1])
        # Hole is off-center; centroid shifts away from it.
        geom={'type':'Polygon','coordinates':[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[2,2],[3,2],[3,3],[2,3],[2,2]]]}
        for v in incident.centroid(geom):self.assertAlmostEqual(v,29.5/15)

    def test_cluster_uses_nearest_instead_of_largest(self):
        rows=[{'latitude':'36','longitude':'128'},
              *[{'latitude':'36.5','longitude':str(128.5+i*.001)} for i in range(20)]]
        self.assertEqual(sorted(map(len,clusters(rows))),[1,20])
        self.assertEqual(select_cluster(rows,[128,36]),[rows[0]])
        self.assertEqual(select_cluster([],[128,36]),[])
        self.assertEqual(select_cluster(rows[1:],[128,36]),[])

    def test_utc_detection_and_ignition_window(self):
        inc=incident.load('hapcheon-2023')
        def row(day,tm):return {'acq_date':day,'acq_time':tm}
        rows=[row('2023-03-08','0509'),row('2023-03-08','0510'),row('2023-03-11','1459'),row('2023-03-11','1500')]
        self.assertEqual(incident_rows(inc,rows),rows[1:3])
        self.assertEqual(acquired(rows[1]).astimezone(incident.KST).hour,14)

    def test_missing_weather_keeps_full_null_time_axis(self):
        inc=incident.load('hapcheon-2023')
        values=align(inc,{'time':['2023-03-07T01:00'],'wind':[4]},'wind')
        self.assertEqual(len(values),len(incident.hours(inc)))
        self.assertIsNone(values[0]);self.assertEqual(values[1],4);self.assertIsNone(values[-1])

    def test_sido_first_and_cross_province_region(self):
        codes,features=incident.region_features(incident.load('geumsan-2023'))
        self.assertEqual(codes,['44710','30170'])
        self.assertEqual({f['properties']['sidonm'] for f in features if f['properties']['sggnm']=='서구'},{'대전광역시'})
        self.assertEqual(incident.region_features(incident.load('daegu-2025'))[0],['27230'])

    def test_gangwon_historical_population_prefix(self):
        self.assertEqual(historical_code('51150','202304'),'42150')
        self.assertEqual(historical_code('51150','202502'),'51150')
        self.assertEqual(items({'Response':{'head':{'resultCode':'0','totalCount':'1'},'items':{'item':[{'a':1}]}}}),([{'a':1}],'1'))
        with self.assertRaises(incident.SourceError):items({'Response':{'head':{'resultCode':'11'},'items':''}})

    def test_private_http_redacts_and_replays_offline(self):
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self):return b'API-SECRET'
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with patch.object(incident,'RAW',root),patch.object(incident,'ROOT',root),patch.object(incident.urllib.request,'urlopen',return_value=Response()) as network:
                for _ in range(2):
                    data=incident.cached_request({'id':'test'},'test','https://example.invalid/API-SECRET',secrets=('API-SECRET',),interval=0)
                    self.assertEqual(data,b'[REDACTED]')
                self.assertEqual(network.call_count,1)
            self.assertTrue(all(b'API-SECRET' not in p.read_bytes() for p in root.rglob('*') if p.is_file()))

    def test_failed_http_is_cached_and_does_not_look_like_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with patch.object(incident,'RAW',root),patch.object(incident,'ROOT',root),patch.object(incident.urllib.request,'urlopen',side_effect=TimeoutError()) as network:
                for _ in range(2):
                    with self.assertRaises(incident.SourceError):incident.cached_request({'id':'test'},'test','https://example.invalid',interval=0)
                self.assertEqual(network.call_count,1)


if __name__=='__main__':unittest.main()
