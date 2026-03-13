<#import "template.ftl" as layout>
<#import "field.ftl" as field>
<#import "buttons.ftl" as buttons>
<#import "social-providers.ftl" as identityProviders>
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>

    <#if section = "header">
        ${msg("loginAccountTitle")}
    <#elseif section = "form">
        <div id="kc-form">
          <div id="kc-form-wrapper">
            <#if realm.password>
                <form id="kc-form-login" class="${properties.kcFormClass!}" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post" novalidate="novalidate">
                    <#if !usernameHidden??>
                        <#assign label>
                            <#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if>
                        </#assign>
                        <@field.input name="username" label=label error=kcSanitize(messagesPerField.getFirstError('username','password'))?no_esc autofocus=true autocomplete="username" value=login.username!'' />
                        <@field.password name="password" label=msg("password") error="" forgotPassword=realm.resetPasswordAllowed autofocus=usernameHidden?? autocomplete="current-password" />
                    <#else>
                        <@field.password name="password" label=msg("password") forgotPassword=realm.resetPasswordAllowed autofocus=usernameHidden?? autocomplete="current-password" />
                    </#if>

                    <div class="${properties.kcFormGroupClass!}">
                        <#if realm.rememberMe && !usernameHidden??>
                            <@field.checkbox name="rememberMe" label=msg("rememberMe") value=login.rememberMe?? />
                        </#if>
                    </div>

                    <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>
                    <@buttons.loginButton />
                </form>
            </#if>
            </div>
        </div>

        <div style="margin-top: 1.5rem; padding: 1rem; border: 1px solid var(--pf-v5-global--BorderColor--100, #d2d2d2); border-radius: 8px; background: var(--pf-v5-global--BackgroundColor--200, #f0f0f0);">
            <div style="font-weight: 600; margin-bottom: 0.5rem; font-size: 0.9rem;">Demo Accounts <span style="font-weight: 400; font-size: 0.8rem;">(password = username)</span></div>
            <table style="width: 100%; font-size: 0.8rem; border-collapse: collapse;">
                <thead>
                    <tr style="text-align: left; border-bottom: 1px solid var(--pf-v5-global--BorderColor--100, #d2d2d2);">
                        <th style="padding: 0.25rem 0.5rem;">User</th>
                        <th style="padding: 0.25rem 0.5rem;">Roles</th>
                    </tr>
                </thead>
                <tbody>
                    <tr><td style="padding: 0.2rem 0.5rem;"><a href="#" onclick="document.getElementById('username').value='alice';document.getElementById('password').value='alice';return false;">alice</a></td><td style="padding: 0.2rem 0.5rem;">admin, customer-service</td></tr>
                    <tr><td style="padding: 0.2rem 0.5rem;"><a href="#" onclick="document.getElementById('username').value='bob';document.getElementById('password').value='bob';return false;">bob</a></td><td style="padding: 0.2rem 0.5rem;">support</td></tr>
                    <tr><td style="padding: 0.2rem 0.5rem;"><a href="#" onclick="document.getElementById('username').value='carol';document.getElementById('password').value='carol';return false;">carol</a></td><td style="padding: 0.2rem 0.5rem;">customer-service</td></tr>
                    <tr><td style="padding: 0.2rem 0.5rem;"><a href="#" onclick="document.getElementById('username').value='dave';document.getElementById('password').value='dave';return false;">dave</a></td><td style="padding: 0.2rem 0.5rem;">(none)</td></tr>
                    <tr><td style="padding: 0.2rem 0.5rem;"><a href="#" onclick="document.getElementById('username').value='eve';document.getElementById('password').value='eve';return false;">eve</a></td><td style="padding: 0.2rem 0.5rem;">admin, order-service</td></tr>
                    <tr><td style="padding: 0.2rem 0.5rem;"><a href="#" onclick="document.getElementById('username').value='frank';document.getElementById('password').value='frank';return false;">frank</a></td><td style="padding: 0.2rem 0.5rem;">support, order-service</td></tr>
                    <tr><td style="padding: 0.2rem 0.5rem;"><a href="#" onclick="document.getElementById('username').value='grace';document.getElementById('password').value='grace';return false;">grace</a></td><td style="padding: 0.2rem 0.5rem;">(none)</td></tr>
                    <tr><td style="padding: 0.2rem 0.5rem;"><a href="#" onclick="document.getElementById('username').value='heidi';document.getElementById('password').value='heidi';return false;">heidi</a></td><td style="padding: 0.2rem 0.5rem;">customer-service, order-service</td></tr>
                    <tr><td style="padding: 0.2rem 0.5rem;"><a href="#" onclick="document.getElementById('username').value='ivan';document.getElementById('password').value='ivan';return false;">ivan</a></td><td style="padding: 0.2rem 0.5rem;">support</td></tr>
                    <tr><td style="padding: 0.2rem 0.5rem;"><a href="#" onclick="document.getElementById('username').value='judy';document.getElementById('password').value='judy';return false;">judy</a></td><td style="padding: 0.2rem 0.5rem;">(none)</td></tr>
                </tbody>
            </table>
        </div>

    <#elseif section = "info" >
        <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
            <div id="kc-registration-container" class="${properties.kcLoginFooterBand!}">
                <div id="kc-registration" class="${properties.kcLoginFooterBandItem!}">
                    <span>${msg("noAccount")} <a href="${url.registrationUrl}">${msg("doRegister")}</a></span>
                </div>
            </div>
        </#if>
    <#elseif section = "socialProviders" >
        <#if realm.password && social.providers?? && social.providers?has_content>
            <@identityProviders.show social=social/>
        </#if>
    </#if>

</@layout.registrationLayout>
