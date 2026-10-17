"""Fetch incident CAMS grid; see fetch_weather for disk caching and alignment."""
from incident import cli
from fetch_weather import fetch

if __name__=='__main__':fetch(cli(__doc__),cams=True)
