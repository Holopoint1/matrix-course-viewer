<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<manifest identifier="{{IDENTIFIER}}" version="1.0"
          xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                              http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd
                              http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="ORG-{{COURSE_ID}}">
    <organization identifier="ORG-{{COURSE_ID}}">
      <title>{{TITLE}}</title>
      <item identifier="ITEM-{{COURSE_ID}}" identifierref="RES-{{COURSE_ID}}" isvisible="true">
        <title>{{TITLE}}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-{{COURSE_ID}}" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>
