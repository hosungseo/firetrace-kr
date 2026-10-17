# gwis_info_gwis_globfire_finalperim: unavailable

Expected JSON; source returned a non-JSON response.

URL: https://maps.effis.emergency.copernicus.eu/gwis?service=WMS&version=1.1.1&request=GetFeatureInfo&layers=gwis.globfire.finalperim&styles=&format=image%2Fpng&transparent=TRUE&width=1024&height=768&bbox=128.2%2C35.9%2C129.6%2C36.8&srs=EPSG%3A4326&TIME=2025-03-28&query_layers=gwis.globfire.finalperim&info_format=application%2Fjson&x=490&y=350&feature_count=100
HTTP status: 200

Verbatim response/error:

```text
<?xml version='1.0' encoding="UTF-8" standalone="no" ?>
<!DOCTYPE ServiceExceptionReport SYSTEM "http://schemas.opengis.net/wms/1.1.1/exception_1_1_1.dtd">
<ServiceExceptionReport version="1.1.1">
<ServiceException code="LayerNotDefined">
msWMSFeatureInfo(): WMS server error. Layer(s) specified in QUERY_LAYERS parameter is not offered by the service instance.
</ServiceException>
</ServiceExceptionReport>

```
