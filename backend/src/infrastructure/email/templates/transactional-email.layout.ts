export const TRANSACTIONAL_EMAIL_LAYOUT = `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
  <!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
  <title>{{title}}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .email-shell { width: 100% !important; }
      .email-card { border-radius: 0 !important; }
      .email-content { padding: 30px 22px 26px !important; }
      .email-header { padding: 25px 20px !important; }
      .email-title { font-size: 28px !important; line-height: 1.18 !important; }
      .email-button-table { width: 100% !important; }
      .email-button { display: block !important; width: auto !important; }
      .footer-column { display: block !important; width: 100% !important; text-align: center !important; }
      .footer-divider { display: none !important; }
      .footer-copyright { padding-top: 18px !important; }
      .detail-label { width: 46% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">{{preheader}}&#847;&zwnj;&nbsp;&#8199;&#65279;&#847;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f8fafc;">
    <tr>
      <td align="center" style="padding:34px 14px;">
        <table role="presentation" class="email-shell email-card" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 14px 38px rgba(15,23,42,0.08);overflow:hidden;">
          <tr>
            <td class="email-header" align="center" style="padding:30px 30px 27px;border-bottom:1px solid #e2e8f0;">
              <img src="{{logoSource}}" width="188" alt="Eventini" style="display:block;width:188px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">
            </td>
          </tr>
          <tr>
            <td class="email-content" style="padding:34px 48px 30px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" style="padding:0 0 21px;">
                    <table role="presentation" width="92" height="92" cellspacing="0" cellpadding="0" border="0" style="width:92px;height:92px;background:{{iconBackground}};border:9px solid {{iconHalo}};border-radius:50%;">
                      <tr><td align="center" valign="middle"><img src="{{iconSource}}" width="54" height="54" alt="" style="display:block;width:54px;height:54px;border:0;"></td></tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" class="email-title" style="padding:0 0 14px;font-size:32px;line-height:1.2;font-weight:700;letter-spacing:-0.7px;color:#0f172a;">{{title}}</td>
                </tr>
                {{#each paragraphs}}
                <tr><td align="center" style="padding:0 0 8px;font-size:16px;line-height:1.62;color:#334155;">{{this}}</td></tr>
                {{/each}}

                {{#if details}}
                <tr><td style="padding:20px 0 4px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #cbd5e1;border-radius:12px;border-collapse:separate;overflow:hidden;">
                    {{#each details}}
                    <tr>
                      <td width="48" align="center" style="padding:13px 5px 13px 16px;border-bottom:{{rowBorder}};font-size:21px;line-height:1;color:#222f90;">{{symbol}}</td>
                      <td class="detail-label" width="46%" style="padding:13px 8px;border-bottom:{{rowBorder}};font-size:14px;line-height:1.45;font-weight:600;color:#334155;">{{label}}</td>
                      <td align="right" style="padding:13px 16px 13px 8px;border-bottom:{{rowBorder}};font-size:14px;line-height:1.45;color:#0f172a;word-break:break-word;">{{value}}</td>
                    </tr>
                    {{/each}}
                  </table>
                </td></tr>
                {{/if}}

                {{#if primaryButton}}
                <tr><td align="center" style="padding:24px 0 8px;">
                  <table role="presentation" class="email-button-table" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto;">
                    <tr><td align="center" bgcolor="#222f90" style="border-radius:9px;background:#222f90;">
                      <!--[if mso]><v:roundrect href="{{primaryButton.url}}" style="height:52px;v-text-anchor:middle;width:390px;" arcsize="17%" stroke="f" fillcolor="#222f90"><w:anchorlock/><center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:16px;font-weight:600;"><![endif]-->
                      <a class="email-button" href="{{primaryButton.url}}" target="_blank" style="display:inline-block;min-width:330px;padding:16px 30px;background:#222f90;border:1px solid #222f90;border-radius:9px;color:#ffffff;font-size:16px;line-height:18px;font-weight:600;text-align:center;text-decoration:none;box-sizing:border-box;">{{primaryButton.label}}</a>
                      <!--[if mso]></center></v:roundrect><![endif]-->
                    </td></tr>
                  </table>
                </td></tr>
                {{/if}}

                {{#if secondaryButton}}
                <tr><td align="center" style="padding:4px 0 8px;">
                  <a href="{{secondaryButton.url}}" target="_blank" style="display:inline-block;min-width:330px;padding:14px 28px;border:1px solid #222f90;border-radius:9px;color:#222f90;font-size:16px;line-height:18px;font-weight:600;text-align:center;text-decoration:none;box-sizing:border-box;">{{secondaryButton.label}}</a>
                </td></tr>
                {{/if}}

                {{#each notices}}
                <tr><td style="padding:16px 0 0;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:{{backgroundColor}};border:1px solid {{borderColor}};border-radius:10px;">
                    <tr>
                      <td width="52" align="center" valign="top" style="padding:17px 5px 16px 15px;font-size:25px;line-height:1;color:{{accentColor}};">{{symbol}}</td>
                      <td style="padding:15px 17px 15px 8px;font-size:14px;line-height:1.55;color:#334155;">
                        {{#if title}}<strong style="display:block;margin-bottom:2px;color:{{accentColor}};">{{title}}</strong>{{/if}}{{text}}
                      </td>
                    </tr>
                  </table>
                </td></tr>
                {{/each}}

                {{#if fallback}}
                <tr><td style="padding:16px 0 0;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e2e8f0;border-radius:10px;background:#ffffff;">
                    <tr>
                      <td width="52" align="center" valign="top" style="padding:17px 5px 16px 15px;font-size:23px;line-height:1;color:#64748b;">&#128279;</td>
                      <td style="padding:15px 17px 15px 8px;font-size:14px;line-height:1.55;color:#334155;">{{fallback.introduction}}<br><a href="{{fallback.url}}" target="_blank" style="color:#1d4ed8;font-weight:600;text-decoration:none;word-break:break-all;">{{fallback.url}}</a></td>
                    </tr>
                  </table>
                </td></tr>
                {{/if}}

                {{#if securityNote}}
                <tr><td style="padding:18px 0 0;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                    <tr>
                      <td width="44" valign="top" style="font-size:24px;line-height:1;color:{{securityNote.accentColor}};">&#9671;</td>
                      <td style="font-size:14px;line-height:1.55;color:#64748b;">{{#if securityNote.title}}<strong style="display:block;color:{{securityNote.accentColor}};">{{securityNote.title}}</strong>{{/if}}{{securityNote.text}}</td>
                    </tr>
                  </table>
                </td></tr>
                {{/if}}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px;"><div style="height:1px;background:#e2e8f0;font-size:1px;line-height:1px;">&nbsp;</div></td>
          </tr>
          <tr>
            <td style="padding:24px 34px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td class="footer-column" width="67%" valign="top" style="padding-right:18px;font-size:13px;line-height:1.55;color:#64748b;">
                    <strong style="color:#334155;">Besoin d'aide ?</strong> Notre équipe est là pour vous.<br>
                    <a href="{{supportUrl}}" target="_blank" style="color:#1d4ed8;text-decoration:none;">Contacter le support</a>
                  </td>
                  <td class="footer-divider" width="1" style="border-left:1px solid #e2e8f0;">&nbsp;</td>
                  <td class="footer-column footer-copyright" width="33%" valign="top" style="padding-left:22px;font-size:13px;line-height:1.55;color:#64748b;">
                    <strong style="color:#334155;">&copy; Eventini</strong><br>Tous droits réservés.
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
