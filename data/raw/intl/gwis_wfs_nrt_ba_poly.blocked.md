# gwis_wfs_nrt_ba_poly: unavailable

Expected JSON; source returned a non-JSON response.

URL: https://maps.effis.emergency.copernicus.eu/gwis?service=WFS&version=1.0.0&request=GetFeature&typeName=nrt.ba.poly&outputFormat=application%2Fjson&bbox=128.2%2C35.9%2C129.6%2C36.8&srsName=EPSG%3A4326&TIME=2025-03-21%2F2025-04-05
HTTP status: 200

Verbatim response/error:

```text
<?xml version='1.0' encoding="UTF-8" ?>
<ServiceExceptionReport version="1.2.0" xmlns="http://www.opengis.net/ogc" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengis.net/ogc http://schemas.opengis.net/wfs/1.0.0/OGC-exception.xsd">
  <ServiceException code="InvalidParameterValue" locator="outputformat">
msWFSGetFeature(): WFS server error. &#39;application/json&#39; is not a permitted output format for layer &#39;nrt.ba.poly&#39;, review wfs_getfeature_formatlist setting.
  </ServiceException>
</ServiceExceptionReport>

```
